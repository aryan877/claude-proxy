# CLAUDE.md — setup & operation guide for coding agents

You are helping a user set up and run **Claude Proxy**: a local server that speaks
the Anthropic Messages API so that **Claude Code can run on non-Anthropic models**
(GPT-5.6 Codex, Gemini, GLM, Cline, OpenRouter, etc.). There is **no npm package to
install** — this repo is cloned and run locally. Your job is to get it working on
the user's machine and explain how to use it.

## What this is

- A Fastify server (`adapters/anthropic-gateway.ts`) listening on
  `http://127.0.0.1:17870/v1/messages`.
- It translates Anthropic requests → each provider's native API, streams the reply
  back as Anthropic SSE, and resolves `/model` shortcuts via `adapters/map.ts`.
- Launcher scripts in `bin/` start the proxy, open Claude Code pointed at it, and
  stop the proxy on exit.

## Setup (do this)

Prerequisites: **Node 18+**, **git**, and **Claude Code** (`claude`) installed and
on PATH. Verify with `node -v` and `claude --version` before starting.

```bash
git clone https://github.com/aryan877/claude-proxy.git ~/claude-proxy
cd ~/claude-proxy
npm install     # installs runtime deps: fastify, tsx, eventsource-parser, dotenv
npm link        # puts claude-codex / claude-gemini / claude-cline / ccx on PATH
```

`npm link` symlinks the launcher commands back to this clone, so future `git pull`s
take effect after a proxy restart (see Gotchas). If the user does not want a global
link, skip it and run launchers directly, e.g.
`node ~/claude-proxy/bin/claude-codex.js`, or add a shell alias.

## Verify it works

Start any launcher (e.g. `claude-codex`) — or boot the proxy alone and probe it:

```bash
# boot the gateway directly on a scratch port
CLAUDE_PROXY_PORT=17999 npm run start:proxy &
# health check — expect {"ok":true,...}
curl -s http://127.0.0.1:17999/healthz
# a real request needs auth for the chosen provider (see below); a 200 SSE or a
# clear provider auth error both confirm the proxy itself is wired correctly.
kill %1
```

## Authentication (per route)

- **Codex** (`claude-codex`): reads `~/.claude-proxy/codex-oauth.json` or
  `~/.codex/auth.json`. If absent, run the launcher and open
  `http://127.0.0.1:17870/codex/login`.
- **Gemini** (`claude-gemini`): open `http://127.0.0.1:17870/google/login` (and
  `/google/login/2` for a failover account).
- **Cline** (`claude-cline`): reads the token live from the Cline app
  (`~/.cline/data/settings/providers.json`); the app must be signed in.
- **API keys** (`ccx`): run `ccx --setup`, then fill `~/.claude-proxy/.env`.

## Running & switching models

Launch: `claude-codex` (or `claude-gemini` / `claude-cline` / `ccx`). Add `-d` for
`--dangerously-skip-permissions`. Shared flags: `--status`, `--proxy-status`,
`--restart`, `--stop`; `--logout` for codex/gemini.

In-session, switch with Claude Code's `/model`:

- Codex: `sol` (default, Extra High), `terra`, `luna`, `gpt55`; effort via
  `@low|@medium|@high|@xhigh|@max` (e.g. `/model terra@max`) or the `fast|smart|
  deep|xhigh|max` shortcuts.
- Any explicit route works: `/model <provider>:<model>` — provider prefixes are
  `codex-oauth`, `gemini-oauth`, `cline-pass`, `openai`, `gemini`, `openrouter`,
  `glm`, `anthropic`.

The full shortcut list is the source of truth in `adapters/map.ts` (`MODEL_SHORTCUTS`).
Read that file to answer "what models/aliases exist" — do not guess.

## Making changes

- **Adapters/gateway are TypeScript run via `tsx`** — no build step to run the
  proxy; the launcher spawns `npx tsx adapters/anthropic-gateway.ts`.
- After editing `adapters/` (models, routing, providers) or `bin/`, **restart the
  proxy** so it reloads: `claude-codex --restart` (a launcher otherwise reuses the
  already-running proxy and your change won't take effect).
- Typecheck: `npm run build`. Tests: `npm test` (vitest).
- Model shortcuts and per-provider defaults live in `adapters/map.ts`. Context
  window + effort defaults for the Codex launcher live in `bin/claude-codex.js`.

## Gotchas

- **Stale proxy.** The #1 confusion: a running proxy is reused across launches, so
  new code/config needs `--restart`. Check what's live with `--proxy-status` or
  `curl http://127.0.0.1:17870/healthz`.
- **One proxy, many routes.** Whichever launcher started the proxy sets the default
  route, but every provider stays reachable via `/model` regardless.
- **No Anthropic key needed** — Claude Code's internal `haiku`/`sonnet` probes are
  remapped to the active provider automatically.
- **Model IDs must be real** for the target provider, or the upstream returns an
  error. When adding/updating a model in `map.ts`, confirm the exact slug the
  provider serves.

## Key files

| File | Purpose |
| --- | --- |
| `adapters/anthropic-gateway.ts` | HTTP server + `/v1/messages` routing |
| `adapters/map.ts` | model shortcuts + provider parsing (**edit models here**) |
| `adapters/providers/*.ts` | per-provider request/stream translation |
| `bin/claude-codex.js` etc. | launchers (defaults, context window, help text) |
| `bin/lib/proxy-launcher.js` | boots the proxy + launches Claude Code |
