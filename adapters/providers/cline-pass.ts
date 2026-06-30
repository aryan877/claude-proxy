// ClinePass adapter — routes through the Cline subscription (api.cline.bot).
// OpenAI-compatible chat completions. The access token is read live from the
// Cline app's providers.json, but ClinePass access tokens only live ~1 hour, so
// this adapter also refreshes them itself (via the stored refresh token) instead
// of relying on the Cline app's hub-daemon to keep the file fresh. Without this,
// the proxy forwards an expired `Bearer workos:<jwt>` and every call 401s with
// "Unauthorized: Please make sure you're using the latest version of Cline…".
import { FastifyReply } from "fastify";
import { readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { streamOpenAICompatible, withStatus } from "./openai-compat.js";
import type { AnthropicRequest, ReasoningLevel } from "../types.js";

const CLINE_BASE = process.env.CLINE_API_BASE_URL || "https://api.cline.bot/api/v1";
const CLINE_REFRESH_URL = `${CLINE_BASE}/auth/refresh`;
const PROVIDERS_PATH =
  process.env.CLINE_PROVIDERS_PATH ||
  join(homedir(), ".cline", "data", "settings", "providers.json");

// Cline tags its access tokens with this scheme; the API rejects a bare JWT.
const WORKOS_PREFIX = "workos:";
// Refresh a little before expiry so an in-flight request never races the deadline.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

type ClineAuth = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
};

function withWorkosPrefix(token: string): string {
  const t = token.trim();
  return t.toLowerCase().startsWith(WORKOS_PREFIX) ? t : `${WORKOS_PREFIX}${t}`;
}

function readProviders(): any {
  let raw: string;
  try {
    raw = readFileSync(PROVIDERS_PATH, "utf-8");
  } catch {
    throw withStatus(
      401,
      `Cline auth not found at ${PROVIDERS_PATH}. Sign in to Cline (open the Cline app or run \`cline\` and authenticate ClinePass).`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw withStatus(401, `Cline providers.json is not valid JSON: ${PROVIDERS_PATH}`);
  }
}

function pickAuth(json: any): ClineAuth {
  const providers = json?.providers ?? {};
  return (
    providers["cline-pass"]?.settings?.auth ??
    providers["cline"]?.settings?.auth ??
    {}
  );
}

// Write refreshed credentials back into every cline* provider entry, atomically
// (temp file + rename) so a concurrent reader never sees a half-written file.
function persistAuth(next: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}) {
  let json: any;
  try {
    json = readProviders();
  } catch {
    return; // best-effort; we still have the token in memory for this request
  }
  const providers = json?.providers ?? {};
  let touched = false;
  for (const key of ["cline-pass", "cline"]) {
    const auth = providers[key]?.settings?.auth;
    if (auth) {
      auth.accessToken = next.accessToken; // already workos:-prefixed
      auth.refreshToken = next.refreshToken;
      auth.expiresAt = next.expiresAt;
      touched = true;
    }
  }
  if (!touched) return;
  try {
    const tmp = `${PROVIDERS_PATH}.ccx-${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(json, null, 2), { mode: 0o600 });
    renameSync(tmp, PROVIDERS_PATH);
  } catch (e: any) {
    console.warn(`[cline-pass] Could not persist refreshed token: ${e.message}`);
  }
}

function normalizeExpiry(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Heuristic: values below ~1e12 are seconds, above are milliseconds.
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  // Unknown shape — assume a conservative ~50 min lifetime.
  return Date.now() + 50 * 60 * 1000;
}

// Dedupe concurrent refreshes: many Claude Code requests can land at once, but
// only one should spend the (single-use, rotating) refresh token.
let refreshInFlight: Promise<string> | null = null;

async function refreshClineToken(refreshToken: string): Promise<string> {
  const resp = await fetch(CLINE_REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken, grantType: "refresh_token" }),
  });

  if (!resp.ok) {
    let detail = "";
    try {
      detail = await resp.text();
    } catch {
      /* ignore */
    }
    throw withStatus(
      401,
      `ClinePass token refresh failed (HTTP ${resp.status}): ${detail || "<no body>"}. ` +
        "Open the Cline app (or run `cline`) and re-authenticate ClinePass.",
    );
  }

  const json: any = await resp.json();
  const data = json?.data ?? json;
  const access: string | undefined = data?.accessToken;
  if (!access) {
    throw withStatus(401, "ClinePass refresh response did not include an accessToken.");
  }
  const refresh: string = data?.refreshToken ?? refreshToken;
  const expiresAt = normalizeExpiry(data?.expiresAt);
  const normalized = withWorkosPrefix(access);

  persistAuth({ accessToken: normalized, refreshToken: refresh, expiresAt });
  console.log(
    `[cline-pass] Refreshed ClinePass token (valid until ${new Date(expiresAt).toISOString()}).`,
  );
  return normalized;
}

function startRefresh(refreshToken: string): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = refreshClineToken(refreshToken).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// Return a usable, workos-prefixed access token, refreshing first if it is
// missing or about to expire.
async function resolveClineToken(): Promise<string> {
  const auth = pickAuth(readProviders());
  const access = auth.accessToken;
  const refresh = auth.refreshToken;

  const fresh =
    typeof auth.expiresAt === "number" && auth.expiresAt > Date.now() + EXPIRY_SKEW_MS;

  if (access && fresh) return withWorkosPrefix(access);

  if (refresh) return startRefresh(refresh);

  if (access) return withWorkosPrefix(access); // no refresh token — try as-is

  throw withStatus(
    401,
    "No ClinePass token in providers.json. Sign in to ClinePass in the Cline app.",
  );
}

// Force a refresh regardless of the cached expiry — used when the upstream
// rejects an otherwise-"fresh" token (e.g. revoked server-side).
async function forceRefreshClineToken(): Promise<string> {
  const auth = pickAuth(readProviders());
  if (!auth.refreshToken) {
    throw withStatus(
      401,
      "ClinePass token rejected and no refresh token is available. Re-authenticate in the Cline app.",
    );
  }
  return startRefresh(auth.refreshToken);
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
  const opts = {
    url: `${CLINE_BASE}/chat/completions`,
    model: toClineModel(model),
    label: "cline-pass",
    reasoningEffort: toReasoningEffort(reasoning),
  };

  let token = await resolveClineToken();
  try {
    return await streamOpenAICompatible(res, body, {
      ...opts,
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e: any) {
    // If the upstream rejected the token and we haven't streamed anything yet,
    // force one refresh and retry — covers tokens revoked mid-validity.
    if (e?.statusCode === 401 && !res.raw.headersSent) {
      console.warn("[cline-pass] Upstream 401 — forcing token refresh and retrying once.");
      token = await forceRefreshClineToken();
      return await streamOpenAICompatible(res, body, {
        ...opts,
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    throw e;
  }
}
