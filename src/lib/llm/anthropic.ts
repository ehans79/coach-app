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
 * Structured generation via a forced tool call rather than free-text + a
 * regex JSON extraction — the zod schema is compiled to the tool's
 * `input_schema` (constraining what the model can even emit, e.g. an enum
 * of valid Garmin exercise identifiers), `strict: true` asks Anthropic to
 * enforce it server-side, and the response is still re-validated locally
 * with the same schema so a type-safe, guaranteed-valid value comes back.
 */
/**
 * Anthropic's `strict: true` tool schemas accept only a subset of JSON Schema,
 * and reject the whole request with a 400 rather than ignoring what they don't
 * support. Numeric bounds (`minimum`/`maximum`/`exclusive*`/`multipleOf`),
 * `maxItems`, a `minItems` above 1, and object property counts are all out;
 * string bounds (`minLength`/`maxLength`/`pattern`/`format`), enums and
 * `const` are all fine.
 *
 * Zod emits the unsupported keywords from ordinary `.min()`/`.max()` calls, so
 * translate them here rather than banning those calls at every call site — that
 * mismatch is what killed the weekly cron once the strength schema started
 * emitting `sections` with min/max 4 (the API's own message misreports the
 * offending values, so it points nowhere useful).
 *
 * Dropping them costs nothing structural: the bounds are still enforced locally
 * by the re-parse in generateStructured, and each affected field states them in
 * its description, which is what the model actually reads.
 */
const UNSUPPORTED_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "maxItems",
  "minProperties",
  "maxProperties",
] as const;

function stripUnsupportedConstraints(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) stripUnsupportedConstraints(child);
    return;
  }
  if (!node || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  for (const keyword of UNSUPPORTED_KEYWORDS) delete obj[keyword];
  // minItems survives, but only as 0 or 1 — clamping keeps "non-empty", which
  // is the closest the wire schema can get to any larger minimum.
  if (typeof obj.minItems === "number" && obj.minItems > 1) obj.minItems = 1;

  for (const child of Object.values(obj)) stripUnsupportedConstraints(child);
}

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
  stripUnsupportedConstraints(inputSchema);

  const response = await getClient().messages.create({
    model: COACHING_MODEL,
    max_tokens: params.maxTokens ?? 4096,
    system: params.system,
    messages: [{ role: "user", content: params.prompt }],
    tools: [
      {
        name: params.toolName,
        description: params.toolDescription,
        input_schema: inputSchema as Anthropic.Tool.InputSchema,
        strict: true,
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

  // Re-validated locally even though Anthropic enforces the schema
  // server-side (strict: true) — belt and suspenders, and it's what gives
  // us a properly typed value back rather than `unknown`.
  return params.schema.parse(toolUseBlock.input);
}
