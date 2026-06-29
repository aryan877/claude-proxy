#!/usr/bin/env node

// claude-cline - ClinePass (Cline subscription) via Claude Code
// Starts proxy, prints available models, launches claude, kills proxy on exit
// Usage: claude-cline [--status] [--restart] [--stop] [--proxy-status] [-d]

import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { launchProxy, stopProxy, proxyStatus } from "./lib/proxy-launcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const PROVIDERS_FILE = join(homedir(), ".cline", "data", "settings", "providers.json");

async function loadClineAuth() {
  try {
    const json = JSON.parse(await readFile(PROVIDERS_FILE, "utf-8"));
    const providers = json?.providers ?? {};
    const entry = providers["cline-pass"] ?? providers["cline"];
    const auth = entry?.settings?.auth;
    if (!auth?.accessToken) return null;
    return { email: decodeEmail(auth.accessToken), expiresAt: auth.expiresAt };
  } catch {
    return null;
  }
}

function decodeEmail(token) {
  try {
    const jwt = token.startsWith("workos:") ? token.slice("workos:".length) : token;
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf-8"));
    return payload?.email;
  } catch {
    return undefined;
  }
}

async function main() {
  const args = process.argv.slice(2);

  console.log("");
  console.log("  claude-cline - ClinePass via Claude Code");
  console.log("  ========================================");
  console.log("");

  if (args.includes("--stop")) { await stopProxy(); console.log(""); return; }
  if (args.includes("--proxy-status")) { await proxyStatus(); console.log(""); return; }

  const auth = await loadClineAuth();

  if (args.includes("--status")) {
    if (auth) {
      console.log(`  Status: Authenticated`);
      console.log(`  Email:  ${auth.email || "unknown"}`);
      const m = auth.expiresAt ? Math.round((auth.expiresAt - Date.now()) / 1000 / 60) : 0;
      console.log(`  Token:  ${m > 0 ? `valid for ${m} min` : "expired (open the Cline app to refresh)"}`);
    } else {
      console.log("  Not authenticated. Open the Cline app (or run `cline`) and sign in to ClinePass.");
    }
    console.log("");
    return;
  }

  if (auth) {
    console.log(`  ClinePass: ${auth.email || "unknown"}   ($0 — included with subscription)`);
  } else {
    console.log("  ClinePass: Not authenticated. Open the Cline app (or run `cline`) and sign in first.");
  }
  console.log("");
  console.log("  Models  /model <name>            Thinking  /model <name>@<level>");
  console.log("  ───────────────────────────────  ─────────────────────────────");
  console.log("   cp · glm52   GLM-5.2 (default)   @none    off — fastest");
  console.log("   cpkimi       Kimi K2.7 Code      @minimal off");
  console.log("   cpkimi26     Kimi K2.6           @low     light");
  console.log("   cpqwen       Qwen3.7 Max         @medium  balanced");
  console.log("   cpqwenplus   Qwen3.7 Plus        @high    deep");
  console.log("   cpminimax    MiniMax-M3          @xhigh   deepest");
  console.log("   cpdeepseek   DeepSeek V4 Pro");
  console.log("   cpflash      DeepSeek V4 Flash   Default thinking = on.");
  console.log("   cpmimo       MiMo-V2.5-Pro       Any model: /model cline-pass:<id>");
  console.log("   cpmimo25     MiMo-V2.5");
  console.log("");
  console.log("   e.g.  /model cpkimi@high   ·   /model cp@none   ·   /model cpflash@minimal");
  console.log("   Session default level:  CLINE_REASONING_EFFORT=none claude-cline");
  console.log("");

  const extraArgs = [];
  if (args.includes("-d") || args.includes("--dangerously-skip-permissions")) {
    extraArgs.push("--dangerously-skip-permissions");
    console.log("  Running with --dangerously-skip-permissions");
    console.log("");
  }

  const claudePassthrough = args.filter(a =>
    !["--restart", "--stop", "--proxy-status", "--status", "-d", "--dangerously-skip-permissions"].includes(a)
  );

  await launchProxy({
    rootDir,
    provider: "cline-pass",
    model: "glm-5.2",
    defaultModel: "cline",
    startedBy: "claude-cline",
    forceRestart: args.includes("--restart"),
    extraArgs: [...extraArgs, ...claudePassthrough],
  });
}

main().catch((err) => { console.error(err.message); process.exit(1); });
