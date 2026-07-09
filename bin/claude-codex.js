#!/usr/bin/env node

// claude-codex - OpenAI Codex via Claude Code
// Starts proxy, prints available models, launches claude, kills proxy on exit
// Usage: claude-codex [--status] [--logout] [--restart] [--stop] [--proxy-status] [-d]

import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { launchProxy, stopProxy, proxyStatus } from "./lib/proxy-launcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const CODEX_AUTH_FILE = join(homedir(), ".codex", "auth.json");
const PROXY_AUTH_FILE = join(homedir(), ".claude-proxy", "codex-oauth.json");
const DEFAULT_CODEX_CONTEXT_WINDOW = 372_000; // GPT-5.6 family (Sol/Terra/Luna); gpt-5.5 was 272k
const DEFAULT_CODEX_EFFECTIVE_PERCENT = 95;

function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
  } catch { return null; }
}

async function loadTokens() {
  try {
    const data = await readFile(PROXY_AUTH_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (parsed.access_token && parsed.refresh_token) return { ...parsed, source: "proxy" };
  } catch {}
  try {
    const data = await readFile(CODEX_AUTH_FILE, "utf-8");
    const parsed = JSON.parse(data);
    const tokens = parsed.tokens;
    if (tokens?.access_token && tokens?.refresh_token) {
      const payload = decodeJwt(tokens.access_token);
      const idPayload = decodeJwt(tokens.id_token);
      return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: payload?.exp ? payload.exp * 1000 : 0,
        email: idPayload?.email || payload?.["https://api.openai.com/profile"]?.email,
        plan: payload?.["https://api.openai.com/auth"]?.chatgpt_plan_type,
        source: "codex-cli",
      };
    }
  } catch {}
  return null;
}

async function main() {
  const args = process.argv.slice(2);

  console.log("");
  console.log("  claude-codex - OpenAI Codex via Claude Code");
  console.log("  ============================================");
  console.log("");

  if (args.includes("--stop")) { await stopProxy(); console.log(""); return; }
  if (args.includes("--proxy-status")) { await proxyStatus(); console.log(""); return; }

  if (args.includes("--logout")) {
    try { const { unlink } = await import("fs/promises"); await unlink(PROXY_AUTH_FILE); console.log("  Logged out."); }
    catch { console.log("  Already logged out."); }
    return;
  }

  const tokens = await loadTokens();

  if (args.includes("--status")) {
    if (tokens) {
      console.log(`  Status: Authenticated`);
      console.log(`  Email:  ${tokens.email || "unknown"}`);
      console.log(`  Plan:   ${tokens.plan || "unknown"}`);
      console.log(`  Source: ${tokens.source}`);
      const m = tokens.expires_at ? Math.round((tokens.expires_at - Date.now()) / 1000 / 60) : 0;
      console.log(`  Token:  ${m > 0 ? `expires in ${m} min` : "expired (auto-refreshes)"}`);
    } else {
      console.log("  Not authenticated. Run claude-codex or install Codex CLI.");
    }
    console.log("");
    return;
  }

  // Auth info
  if (tokens) {
    console.log(`  OpenAI: ${tokens.email || "unknown"} (${tokens.plan || "unknown"})`);
  } else {
    console.log("  OpenAI: Not authenticated");
    console.log("  Login at: http://127.0.0.1:17870/codex/login");
  }
  console.log("");

  // GPT-5.6 family: Sol (frontier) / Terra (balanced) / Luna (fast). Switch with /model.
  console.log("  Models: GPT-5.6 family  (372k context window)");
  console.log("  ─────────────────────────────────────────────");
  console.log("    /model sol       gpt-5.6-sol    Frontier — hardest coding & research (default)");
  console.log("    /model terra     gpt-5.6-terra  Balanced — everyday high-volume work");
  console.log("    /model luna      gpt-5.6-luna   Fast & affordable — routine tasks");
  console.log("    /model gpt55     gpt-5.5        Previous frontier (272k window)");
  console.log("");
  console.log("  Reasoning level (Sol shortcuts, or add @level to any model):");
  console.log("  ─────────────────────────────────────────────");
  console.log("    /model fast      sol @low       Fast, lighter reasoning");
  console.log("    /model smart     sol @medium    Balanced (Codex default)");
  console.log("    /model deep      sol @high      Deeper reasoning");
  console.log("    /model max       sol @max       Top reasoning");
  console.log("    /model think     sol @max       Alias for max");
  console.log("");
  console.log("  Verbatim @level works on every model:");
  console.log("    /model terra@max   /model luna@high   /model sol@low   /model codex@xhigh");
  console.log("");

  // Extra flags
  const extraArgs = [];
  if (args.includes("-d") || args.includes("--dangerously-skip-permissions")) {
    extraArgs.push("--dangerously-skip-permissions");
    console.log("  Running with --dangerously-skip-permissions");
    console.log("");
  }

  // Filter out our flags, pass the rest to claude
  const claudePassthrough = args.filter(a =>
    !["--restart", "--stop", "--proxy-status", "--status", "--logout", "-d", "--dangerously-skip-permissions"].includes(a)
  );

  const contextWindow = positiveIntEnv("CODEX_CONTEXT_WINDOW_TOKENS", DEFAULT_CODEX_CONTEXT_WINDOW);
  const defaultAutoCompact = Math.floor(contextWindow * DEFAULT_CODEX_EFFECTIVE_PERCENT / 100);
  const autoCompactWindow = Math.min(
    positiveIntEnv("CODEX_AUTO_COMPACT_WINDOW_TOKENS", defaultAutoCompact),
    contextWindow,
  );

  await launchProxy({
    rootDir,
    provider: "codex-oauth",
    model: "gpt-5.6-sol",
    defaultModel: "codex",
    startedBy: "claude-codex",
    forceRestart: args.includes("--restart"),
    extraArgs: [...extraArgs, ...claudePassthrough],
    contextWindow,
    autoCompactWindow,
    disableCompact: process.env.CODEX_DISABLE_COMPACT === "1",
  });
}

main().catch((err) => { console.error(err.message); process.exit(1); });
