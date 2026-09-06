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
  // turns a schema-violating response into a thrown error instead of bad data,
  // and gives us a properly typed value back rather than `unknown`.
  return params.schema.parse(toolUseBlock.input);
}
