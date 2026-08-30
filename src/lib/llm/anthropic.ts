import Anthropic from "@anthropic-ai/sdk";
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
