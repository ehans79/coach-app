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
