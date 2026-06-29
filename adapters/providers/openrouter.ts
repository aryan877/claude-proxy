// OpenRouter adapter (OpenAI-compatible API) with full tool calling support
import { FastifyReply } from "fastify";
import { streamOpenAICompatible, withStatus } from "./openai-compat.js";
import type { AnthropicRequest } from "../types.js";

const OR_BASE = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

export async function chatOpenRouter(
  res: FastifyReply,
  body: AnthropicRequest,
  model: string,
  apiKey?: string,
) {
  if (!apiKey) {
    throw withStatus(401, "Missing OPENROUTER_API_KEY. Set it in ~/.claude-proxy/.env");
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (process.env.OPENROUTER_REFERER) headers["HTTP-Referer"] = process.env.OPENROUTER_REFERER;
  if (process.env.OPENROUTER_TITLE) headers["X-Title"] = process.env.OPENROUTER_TITLE;

  return streamOpenAICompatible(res, body, {
    url: `${OR_BASE}/chat/completions`,
    headers,
    model,
    label: "openrouter",
  });
}
