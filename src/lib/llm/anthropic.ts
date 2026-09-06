import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getEnv } from "@/lib/env";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  }
  return client;
}

// Low request volume (a handful of activity comments/week, one plan
// regeneration/week) — quality matters more than cost here, so use the
// top-tier model rather than optimizing spend.
export const COACHING_MODEL = "claude-opus-5";

export async function generateText(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  const response = await getClient().messages.create({
    model: COACHING_MODEL,
    max_tokens: params.maxTokens ?? 1024,
    system: params.system,
    messages: [{ role: "user", content: params.prompt }],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  if (!textBlock) {
    throw new Error(`Claude response had no text block (stop_reason: ${response.stop_reason})`);
  }
  return textBlock.text.trim();
}

/**
 * A schema violation reported in a form a human can actually read in the logs.
 *
 * Raising zod's own error here is worse than useless in production: an
 * `exerciseName` that misses the catalog produces a message listing all 1527
 * valid options, and the Sunday cron logs it per failing exercise. That flood
 * tripped Railway's 500-logs/sec replica limit, which dropped 1031 lines —
 * including the head of the stack trace — so the actual failure was invisible
 * in the one place it needed to be legible.
 *
 * Each issue is reported as "path: message (sent: value)" instead, with the
 * message capped and the offending value read back out of the response by path,
 * which is the part that actually identifies what the model got wrong.
 */
export class StructuredResponseError extends Error {
  declare readonly issues: z.core.$ZodIssue[];

  constructor(toolName: string, error: z.ZodError, rawInput: unknown) {
    const shown = error.issues.slice(0, MAX_REPORTED_ISSUES);
    const lines = shown.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      const message = truncate(issue.message, MAX_ISSUE_MESSAGE_CHARS);
      const sent = truncate(JSON.stringify(valueAtPath(rawInput, issue.path)) ?? "undefined", 120);
      return `  ${path}: ${message} (sent: ${sent})`;
    });
    const omitted = error.issues.length - shown.length;
    if (omitted > 0) lines.push(`  ...and ${omitted} more issue(s)`);

    super(`Claude's ${toolName} response failed schema validation:\n${lines.join("\n")}`);
    this.name = "StructuredResponseError";
    // Non-enumerable on purpose. console.error(err) prints an error's own
    // enumerable properties, so a plain assignment here would re-dump every
    // enum option through the message zod put on each issue — the exact flood
    // the compact message above exists to avoid.
    Object.defineProperty(this, "issues", { value: error.issues, enumerable: false });
  }
}

const MAX_SCHEMA_ATTEMPTS = 3;
const MAX_REPORTED_ISSUES = 10;
const MAX_ISSUE_MESSAGE_CHARS = 200;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function valueAtPath(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/**
 * Structured generation via a forced tool call rather than free-text + a
 * regex JSON extraction: the zod schema is compiled to the tool's
 * `input_schema`, so the model sees the exact shape it must produce —
 * including the enum of valid Garmin exercise names — and the response is
 * re-validated locally with the same schema, which is what gives a type-safe,
 * guaranteed-valid value back rather than `unknown`.
 *
 * Deliberately NOT sent with `strict: true`. Strict compiles the schema into a
 * decoding grammar and rejects the request outright when it can't, and this
 * schema is far outside what that compiler accepts — measured against the live
 * API, not guessed:
 *
 *   - "too many optional parameters (78) ... (limit: 24)". The weekly schema
 *     inlines the workout object once per weekday, so its 7 optional fields
 *     plus the strength section's 4 count seven times over. Emitting `$defs`
 *     via zod's `reused: "ref"` does drop the count to 12, and the request is
 *     then rejected as "Schema is too complex" instead.
 *   - that complexity ceiling is what really rules strict out here: the
 *     exercise-name enum trips it at 200 entries, and the catalog has 1527.
 *     There is no version of this schema that keeps the real catalog and
 *     compiles.
 *
 * Without strict, the same schema — enum, bounds and all — is accepted as-is,
 * and every constraint still reaches the model as part of the tool definition.
 * What's lost is only the server-side guarantee, so validity rests on the local
 * re-parse below plus ExerciseCatalog.lookup(): a bad response becomes a thrown
 * error rather than bad data reaching the database.
 */
export async function generateStructured<T>(params: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  toolName: string;
  toolDescription: string;
  maxTokens?: number;
}): Promise<T> {
  // Anthropic's input_schema wants a plain JSON Schema object — drop zod's
  // "$schema" dialect-identifier key, which isn't part of that shape.
  const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(params.schema) as Record<string, unknown> & {
    $schema?: string;
  };
  void _dialect;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: params.prompt }];

  // Without strict the schema is an instruction, not a guarantee, so a single
  // bad field is a live possibility — and the first real run hit exactly that:
  // one exercise came back as "Bird Dog", which Garmin's catalog calls "Back
  // Extension with Opposite Arm and Leg Reach". Failing the whole weekly job
  // (and the debrief email behind it) over one name out of a full week is the
  // wrong trade, and the model can nearly always fix it when told precisely
  // what was rejected, so hand the violations back as a tool error and let it
  // resubmit rather than giving up on the first attempt.
  for (let attempt = 1; attempt <= MAX_SCHEMA_ATTEMPTS; attempt++) {
    const response = await getClient().messages.create({
      model: COACHING_MODEL,
      max_tokens: params.maxTokens ?? 4096,
      system: params.system,
      messages,
      tools: [
        {
          name: params.toolName,
          description: params.toolDescription,
          input_schema: inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: params.toolName },
    });

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (!toolUseBlock) {
      throw new Error(`Claude response had no tool_use block (stop_reason: ${response.stop_reason})`);
    }

    // The only enforcement there is, now that strict is off (see above): this
    // turns a schema-violating response into a caught error instead of bad
    // data, and gives us a properly typed value back rather than `unknown`.
    const parsed = params.schema.safeParse(toolUseBlock.input);
    if (parsed.success) return parsed.data;

    const violation = new StructuredResponseError(params.toolName, parsed.error, toolUseBlock.input);
    if (attempt === MAX_SCHEMA_ATTEMPTS) throw violation;
    console.warn(`${violation.message}\n  Retrying (attempt ${attempt + 1} of ${MAX_SCHEMA_ATTEMPTS}).`);

    // Echoing the assistant turn back verbatim keeps any thinking blocks intact
    // (adaptive thinking is on by default for this model) and gives the retry
    // the rest of the plan it already wrote, so it only has to repair the parts
    // named below rather than start over.
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseBlock.id,
          is_error: true,
          content:
            `${violation.message}\n\n` +
            "Every value must come from the schema exactly as written — for an exercise name, " +
            "that means an exact entry from the enum, not a common name for the same movement. " +
            "Resubmit the whole week with only the listed problems corrected.",
        },
      ],
    });
  }

  // Unreachable: the final attempt either returns or throws above.
  throw new Error(`${params.toolName} generation exhausted ${MAX_SCHEMA_ATTEMPTS} attempts`);
}
