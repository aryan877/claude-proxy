// Proxy launcher — starts proxy, launches claude, kills proxy on exit
//
// The proxy is provider-agnostic: it routes by model name (e.g. "codex" → codex-oauth,
// "gemini" → gemini-oauth). So if claude-codex started the proxy and claude-gemini
// runs next, it just reuses the same proxy — no restart needed.

import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import {
  readLock, removeLock, isAlive,
  fetchHealth, killPid, killPortOccupant,
} from "./pid-manager.js";

// ── Wait for proxy health ────────────────────────────────────────────

async function waitForProxy(port, maxWait = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const h = await fetchHealth(port);
    if (h) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Start proxy (background), launch claude, kill proxy on exit.
 *
 * Strategy:
 * 1. Healthy proxy already running? → Reuse it (proxy is provider-agnostic)
 * 2. Stale/zombie process on port?  → Kill it, start fresh
 * 3. Port free?                     → Start new proxy
 */
export async function launchProxy({ rootDir, provider, model, defaultModel, startedBy, forceRestart = false, extraArgs = [], contextWindow }) {
  const PORT = Number(process.env.CLAUDE_PROXY_PORT || 17870);

  // Step 1: Check if a healthy proxy is already running
  // If /healthz responds, it's our proxy — no random process would have that endpoint.
  const health = await fetchHealth(PORT);

  if (health && !forceRestart) {
    console.log(`  Proxy already running (PID ${health.pid}, ${health.active?.provider || "unknown"}:${health.active?.model || "auto"})`);
  } else {
    // Step 2: Clean up anything occupying the port
    if (health && forceRestart) {
      const lock = await readLock();
      const pidToKill = lock?.pid || health.pid;
      if (pidToKill) {
        console.log(`  Restarting proxy (killing PID ${pidToKill})...`);
        await killPid(pidToKill);
        await new Promise(r => setTimeout(r, 300));
      }
    } else {
      // No health response — check for zombie from lock file
      const lock = await readLock();
      if (lock?.pid && isAlive(lock.pid)) {
        console.log(`  Stale proxy detected (PID ${lock.pid}, not responding). Killing...`);
        await killPid(lock.pid);
        await new Promise(r => setTimeout(r, 300));
      }
      await removeLock();
      killPortOccupant(PORT);
      await new Promise(r => setTimeout(r, 200));
    }

    // Step 3: Start a new proxy
    const proxyLog = join(homedir(), ".claude-proxy", "proxy.log");
    const proxy = spawn("npx", ["tsx", join(rootDir, "adapters", "anthropic-gateway.ts")], {
      cwd: rootDir,
      env: { ...process.env, CCX_DEFAULT_PROVIDER: provider, CCX_DEFAULT_MODEL: model },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    const fs = await import("fs");
    const logStream = fs.createWriteStream(proxyLog, { flags: "a" });
    proxy.stdout.pipe(logStream);
    proxy.stderr.pipe(logStream);

    proxy.stdout.on("data", (d) => process.stdout.write(d));
    proxy.stderr.on("data", (d) => process.stderr.write(d));

    console.log(`  Starting proxy in background...`);
    const ready = await waitForProxy(PORT);
    if (!ready) {
      console.error(`  Proxy failed to start. Check: ${proxyLog}`);
      proxy.kill("SIGTERM");
      process.exit(1);
    }

    proxy.stdout.removeAllListeners("data");
    proxy.stderr.removeAllListeners("data");

    const cleanup = () => { try { proxy.kill("SIGTERM"); } catch {} };
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  }

  // Launch claude
  console.log("");

  const claudeArgs = ["--model", defaultModel, ...extraArgs];

  // Underlying provider supports a bigger context than Claude Code's default 200K
  // (Codex / gpt-5.5 ~ 1M, Gemini 3 Pro ~ 1M). Tell Claude Code so it doesn't
  // auto-compact prematurely. Caller can override via env if they want.
  //
  // Claude Code caps AUTO_COMPACT_WINDOW at the model's hardcoded context window —
  // 200K for unknown model names like "codex" — via Math.min(modelWindow, envValue).
  // The actual escape hatch is the combo DISABLE_COMPACT=1 + CLAUDE_CODE_MAX_CONTEXT_TOKENS=<n>,
  // which Claude Code's hP() reads first and returns directly as the model window.
  const claudeEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || "local-proxy-token",
  };
  if (contextWindow) {
    const win = String(contextWindow);
    if (!process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) {
      claudeEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW = win;
    }
    if (!process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS) {
      claudeEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS = win;
    }
    if (!process.env.DISABLE_COMPACT) {
      claudeEnv.DISABLE_COMPACT = "1";
    }
    console.log(`  Context window: ${(contextWindow / 1e6).toFixed(1)}M tokens (auto-compact disabled)`);
  }

  const claude = spawn("claude", claudeArgs, {
    stdio: "inherit",
    env: claudeEnv,
  });

  claude.on("error", (err) => {
    if (err.message.includes("ENOENT")) {
      console.error("  'claude' command not found. Install Claude Code first.");
    } else {
      console.error(`  Failed to launch claude: ${err.message}`);
    }
    process.exit(1);
  });

  claude.on("close", (code) => {
    process.exit(code ?? 0);
  });
}

export async function stopProxy() {
  const PORT = Number(process.env.CLAUDE_PROXY_PORT || 17870);
  const health = await fetchHealth(PORT);
  if (health) {
    const lock = await readLock();
    const pid = lock?.pid || health.pid;
    console.log(`  Stopping proxy (PID ${pid})...`);
    if (await killPid(pid)) console.log("  Stopped.");
    else {
      killPortOccupant(PORT);
      console.log("  Stopped (force).");
    }
  } else {
    const lock = await readLock();
    if (lock?.pid && isAlive(lock.pid)) {
      console.log(`  Killing stale proxy (PID ${lock.pid})...`);
      await killPid(lock.pid);
      console.log("  Killed.");
    } else {
      killPortOccupant(PORT);
      await removeLock();
      console.log("  No proxy running.");
    }
  }
}

export async function proxyStatus() {
  const PORT = Number(process.env.CLAUDE_PROXY_PORT || 17870);
  const health = await fetchHealth(PORT);
  const lock = await readLock();
  if (health) {
    console.log(`  PID:        ${health.pid}`);
    console.log(`  Port:       ${PORT}`);
    console.log(`  Started:    ${new Date(health.startedAt).toLocaleString()}`);
    console.log(`  Healthy:    yes`);
    if (health.active) console.log(`  Provider:   ${health.active.provider}:${health.active.model}`);
    if (lock?.pid && lock.pid !== health.pid) {
      console.log(`  Warning:    PID lock (${lock.pid}) doesn't match running proxy`);
    }
  } else if (lock?.pid && isAlive(lock.pid)) {
    console.log(`  PID:        ${lock.pid}`);
    console.log(`  Port:       ${PORT}`);
    console.log(`  Healthy:    no (process alive but not responding)`);
  } else {
    console.log("  No proxy running.");
  }
}
