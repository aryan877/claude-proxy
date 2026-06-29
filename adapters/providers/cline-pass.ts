// ClinePass adapter — routes through the Cline subscription (api.cline.bot).
// OpenAI-compatible chat completions; token is read live from the Cline app's
// providers.json (kept fresh by Cline's hub-daemon while the app is signed in).
import { FastifyReply } from "fastify";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { streamOpenAICompatible, withStatus } from "./openai-compat.js";
import type { AnthropicRequest, ReasoningLevel } from "../types.js";

const CLINE_BASE = process.env.CLINE_API_BASE_URL || "https://api.cline.bot/api/v1";
const PROVIDERS_PATH =
  process.env.CLINE_PROVIDERS_PATH ||
  join(homedir(), ".cline", "data", "settings", "providers.json");

function loadClineToken(): string {
  let raw: string;
  try {
    raw = readFileSync(PROVIDERS_PATH, "utf-8");
  } catch {
    throw withStatus(
      401,
      `Cline auth not found at ${PROVIDERS_PATH}. Sign in to Cline (open the Cline app or run \`cline\` and authenticate ClinePass).`,
    );
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw withStatus(401, `Cline providers.json is not valid JSON: ${PROVIDERS_PATH}`);
  }

  const providers = json?.providers ?? {};
  const auth = providers["cline-pass"]?.settings?.auth ?? providers["cline"]?.settings?.auth;
  const token = auth?.accessToken;
  if (!token) {
    throw withStatus(
      401,
      "No ClinePass token in providers.json. Sign in to ClinePass in the Cline app.",
    );
  }

  if (typeof auth.expiresAt === "number" && auth.expiresAt < Date.now() + 30_000) {
    const ageSec = Math.round((Date.now() - auth.expiresAt) / 1000);
    console.warn(
      `[cline-pass] Stored token expired ~${ageSec}s ago. Keep the Cline app open so it auto-refreshes, or re-auth in Cline.`,
    );
  }

  return token;
}

function toClineModel(model: string): string {
  return model.startsWith("cline-pass/") ? model : `cline-pass/${model}`;
}

// ClinePass accepts the full set natively: none | minimal | low | medium | high | xhigh.
// none/minimal = thinking off. Falls back to CLINE_REASONING_EFFORT, else the model default.
function toReasoningEffort(r?: ReasoningLevel): string | undefined {
  const level = r || process.env.CLINE_REASONING_EFFORT?.toLowerCase();
  if (!level) return undefined;
  return level;
}

export async function chatClinePass(
  res: FastifyReply,
  body: AnthropicRequest,
  model: string,
  reasoning?: ReasoningLevel,
) {
  const token = loadClineToken();

  return streamOpenAICompatible(res, body, {
    url: `${CLINE_BASE}/chat/completions`,
    headers: { Authorization: `Bearer ${token}` },
    model: toClineModel(model),
    label: "cline-pass",
    reasoningEffort: toReasoningEffort(reasoning),
  });
}
