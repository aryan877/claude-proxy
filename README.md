# Claude Proxy

**Run Claude Code on any model — GPT-5.6 Codex, Gemini 3, GLM-5.2, Claude, or anything on OpenRouter — without changing how you work.**

Claude Proxy is a tiny local server that speaks the Anthropic Messages API. Claude
Code keeps talking to `http://127.0.0.1:17870/v1/messages`; the proxy translates
each request into the target provider's native format, streams the reply back as
Anthropic SSE, and lets you hop between models mid-session with `/model`.

Log in with the accounts you already pay for — a **ChatGPT/Codex** plan, a
**Google** account, a **Cline** subscription — or bring plain **API keys**. No
Anthropic key required.

- **Codex (OAuth)** — GPT-5.6 **Sol / Terra / Luna** and GPT-5.5, with per-model reasoning effort
- **Gemini (OAuth)** — Gemini 3.1 Pro / Flash, 3 Pro, and 2.5, via Google Code Assist
- **ClinePass** — every model in your Cline subscription at `$0` per call
- **API keys** — OpenAI Responses, OpenRouter, Google Gemini, Z.AI GLM, Anthropic passthrough
- Streaming + non-streaming, tool use, vision, thinking blocks, and native server-side web search

There's no package to install from a registry — you **clone the repo and run it
locally**. Point your coding agent at it and it can set everything up for you; see
[CLAUDE.md](CLAUDE.md).

---

## Setup

Prerequisites: **Node 18+**, **git**, and **Claude Code** already installed.

```bash
git clone https://github.com/aryan877/claude-proxy.git
cd claude-proxy
npm install     # runtime deps (fastify, tsx, …)
npm link        # exposes the launcher commands on your PATH
```

Then start a launcher — it boots the proxy, opens Claude Code wired to it, and
stops the proxy when you exit:

```bash
claude-codex      # ChatGPT/Codex login  → GPT-5.6 Sol (Extra High) by default
claude-gemini     # Google login          → Gemini 3.1 Pro
claude-cline      # Cline subscription     → GLM-5.2 ($0/call)
ccx --setup && ccx # your own API keys     → GLM-5.2
```

First run prints a login URL if you aren't authenticated yet.

**Prefer not to `npm link`?** Run a launcher directly, or alias it:

```bash
node ~/claude-proxy/bin/claude-codex.js
# or, in your shell rc:
alias claude-codex="node ~/claude-proxy/bin/claude-codex.js"
```

### Commands

| Command | Default model | Auth |
| --- | --- | --- |
| `claude-codex` | `codex-oauth:gpt-5.6-sol@xhigh` | ChatGPT/Codex OAuth, or existing Codex CLI tokens |
| `claude-gemini` | `gemini-oauth:gemini-3.1-pro-preview` | Google OAuth |
| `claude-cline` | `cline-pass:glm-5.2` | Cline subscription (token read from the Cline app) |
| `ccx` | `glm:glm-5.2` | API keys in `~/.claude-proxy/.env` |

Each has a `-d` sibling (`claude-codex-d`, `claude-gemini-d`, `claude-cline-d`,
`ccx-d`) that adds `--dangerously-skip-permissions`. All launchers share
`--status`, `--proxy-status`, `--restart`, `--stop`, and `-d`; `claude-codex` and
`claude-gemini` also support `--logout`.

> **After pulling changes, restart the proxy.** A launcher reuses an
> already-running proxy, so new models/config won't apply until you run
> `<launcher> --restart` (or `--stop`, then relaunch).

---

## Launchers

### `claude-codex` — GPT-5.6 Codex via ChatGPT/OAuth

Routes Claude Code to OpenAI's ChatGPT/Codex backend. The GPT-5.6 family shares a
**372k-token context window**; **Sol** starts at **Extra High** effort.

| Shortcut | Model | Role |
| --- | --- | --- |
| `sol` · `codex` · `cx` | `gpt-5.6-sol` | Frontier — hardest coding & research (**default**) |
| `terra` | `gpt-5.6-terra` | Balanced — everyday, high-volume work |
| `luna` | `gpt-5.6-luna` | Fast & affordable — routine tasks |
| `gpt55` | `gpt-5.5` | Previous frontier (272k window) |

Tokens are looked up in `~/.claude-proxy/codex-oauth.json`, then
`~/.codex/auth.json`. If neither exists, launch and open the login URL it prints:

```
http://127.0.0.1:17870/codex/login
```

### `claude-gemini` — Gemini via Google OAuth

Routes Claude Code to Gemini through Google Code Assist. Default model is
`gemini-3.1-pro-preview`, declared with a **1,000,000-token context window** and
Claude Code auto-compact disabled.

First run, open `http://127.0.0.1:17870/google/login`. Link a **second** Google
account for automatic failover when the first hits a 429 (rate limit):
`http://127.0.0.1:17870/google/login/2`. Tokens live in
`~/.claude-proxy/google-oauth.json` and `…-oauth-2.json`.

### `claude-cline` — your Cline subscription ($0/call)

Routes Claude Code through your paid **Cline / ClinePass** subscription
(`https://api.cline.bot`), so included models cost `$0` per call. The OAuth token
is read live from the Cline app (`~/.cline/data/settings/providers.json`) and
refreshed by the proxy — keep the Cline app signed in. Default model is `glm-5.2`.

| Shortcut | Model | Shortcut | Model |
| --- | --- | --- | --- |
| `cp` · `glm52` | `glm-5.2` (default) | `cpminimax` | `minimax-m3` |
| `cpkimi` | `kimi-k2.7-code` | `cpdeepseek` | `deepseek-v4-pro` |
| `cpkimi26` | `kimi-k2.6` | `cpflash` | `deepseek-v4-flash` |
| `cpqwen` | `qwen3.7-max` | `cpmimo` | `mimo-v2.5-pro` |
| `cpqwenplus` | `qwen3.7-plus` | `cpmimo25` | `mimo-v2.5` |

Any Cline model also works verbatim: `/model cline-pass:<id>`. Set a session-wide
thinking default with `CLINE_REASONING_EFFORT` (e.g.
`CLINE_REASONING_EFFORT=none claude-cline`).

### `ccx` — your own API keys, all providers

Starts the multi-provider API-key route. Claude Code launches on `glm` (`glm:glm-5`).

```bash
ccx --setup   # writes ~/.claude-proxy/.env
ccx
```

`ccx --setup` scaffolds `~/.claude-proxy/.env`:

```bash
# OpenAI Responses API
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_REFERER=
OPENROUTER_TITLE=Claude Code via ccx

# Gemini API key
GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta

# Z.AI GLM
GLM_UPSTREAM_URL=https://api.z.ai/api/anthropic
ZAI_API_KEY=

# Anthropic passthrough
ANTHROPIC_UPSTREAM_URL=https://api.anthropic.com
ANTHROPIC_API_KEY=
ANTHROPIC_VERSION=2023-06-01

# Local proxy
CLAUDE_PROXY_PORT=17870
```

`GLM_API_KEY` is accepted as a fallback for `ZAI_API_KEY`.

---

## Switching models

Use Claude Code's `/model` command. Shortcuts are defined in `adapters/map.ts`;
explicit provider routes always work too.

```text
/model sol            # a shortcut
/model codex-oauth:gpt-5.6-terra
/model gemini-oauth/gemini-3-flash-preview
```

### Provider prefixes

| Prefix | Route |
| --- | --- |
| `codex-oauth` | ChatGPT/Codex backend (OAuth) |
| `gemini-oauth` | Google Code Assist / Gemini (OAuth) |
| `cline-pass` | Cline subscription |
| `openai` | OpenAI Responses API (`OPENAI_API_KEY`) |
| `gemini` | Gemini API (`GEMINI_API_KEY`) |
| `openrouter` | OpenRouter (`OPENROUTER_API_KEY`) |
| `glm` | Z.AI Anthropic-compatible GLM |
| `anthropic` | Anthropic passthrough |

### Codex (GPT-5.6) shortcuts

Model shortcuts plus reasoning-effort shortcuts. Sol/Terra/Luna carry a 372k
window; Sol defaults to **Extra High**, the others to **High**.

| Shortcut | Route |
| --- | --- |
| `sol` · `codex` · `cx` · `gpt56` · `gpt-5.6-sol` | `gpt-5.6-sol@xhigh` |
| `terra` · `gpt-5.6-terra` | `gpt-5.6-terra` |
| `luna` · `gpt-5.6-luna` | `gpt-5.6-luna` |
| `gpt55` · `gpt-5.5` | `gpt-5.5` (272k window) |
| `fast` | `gpt-5.6-sol@low` |
| `smart` | `gpt-5.6-sol@medium` |
| `deep` | `gpt-5.6-sol@high` |
| `xhigh` · `extra` | `gpt-5.6-sol@xhigh` |
| `max` · `think` | `gpt-5.6-sol@max` |

All route through `codex-oauth:`. Append `@level` to override effort on any
model — `/model terra@max`, `/model luna@high`, `/model sol@low`.

### Gemini shortcuts

| Shortcut | Route |
| --- | --- |
| `gemini` · `gemini-pro` · `gp` · `gemini-31p` | `gemini-oauth:gemini-3.1-pro-preview` |
| `gemini-flash` · `gf` | `gemini-oauth:gemini-3-flash-preview` |
| `gemini-3p` | `gemini-oauth:gemini-3-pro-preview` |
| `gemini-31f` | `gemini-oauth:gemini-3.1-flash-preview` |
| `gemini-25p` · `gemini-25f` | `gemini-oauth:gemini-2.5-pro` / `gemini-2.5-flash` |

### GLM, MiniMax, and Claude shortcuts

| Shortcut | Route |
| --- | --- |
| `g` · `glm` · `glm52z` | `glm:glm-5.2` (current flagship, 1M ctx) |
| `glm51` · `glm5` · `glm47` · `glm45` | `glm:glm-5.1` / `glm-5` / `glm-4.7` / `glm-4.5` |
| `flash` | `glm:glm-4.7-flash` |
| `glm5or` | `openrouter:z-ai/glm-5` |
| `minimax` · `mm` · `m25` | `openrouter:minimax/minimax-m2.5` |
| `opus` · `sonnet` · `haiku` | `anthropic:claude-opus-4-8` / `claude-sonnet-5` / `claude-haiku-4-5` |

---

## Reasoning / thinking

Append an effort suffix to any supported model: `@none` · `@minimal` · `@low` ·
`@medium` · `@high` · `@xhigh` · `@max`.

| Provider | How it maps |
| --- | --- |
| Codex / OpenAI | `reasoning.effort`. GPT-5.6 accepts up to `max`; GPT-5.5 tops out at `xhigh`. `none`/`minimal` floor to `low`. |
| Gemini 3.1 & Flash | `thinkingLevel` |
| Gemini 3 Pro | `LOW` or `HIGH` only (`medium` is raised to `HIGH`) |
| Gemini 2.5 | thinking token budget |
| ClinePass | thinking level (`none`/`minimal` = off) |

Defaults when you don't pass a level: **Sol → Extra High (`xhigh`)**; Terra, Luna,
and GPT-5.5 → **High**; Gemini → full thinking. Override the Codex fallback with
`CODEX_REASONING_EFFORT`.

> **Why no `ultra`?** In the Codex app, `ultra` is a multi-agent orchestration
> mode — it spawns subagents — and Codex itself sends it to the API as `max`. A
> single-request proxy has nothing extra to send, so `max` is the ceiling here.

---

## Context windows

`claude-codex` declares a **372,000-token** context window to Claude Code and
auto-compacts at 95% by default. (GPT-5.5 is really 272k — set the override below
for a 5.5-only session.) Claude Code's generated compaction-summary turn is
automatically capped at **Medium** reasoning so a normal Extra High/Max session
does not spend several minutes overthinking the summary; ordinary turns keep
their selected effort.

```bash
CODEX_CONTEXT_WINDOW_TOKENS=272000 claude-codex   # e.g. when staying on gpt-5.5
CODEX_AUTO_COMPACT_WINDOW_TOKENS=340000 claude-codex
CODEX_DISABLE_COMPACT=1 claude-codex
```

`claude-gemini` declares a **1,000,000-token** window and disables auto-compact by
default.

---

## How it works

```text
Claude Code
    │  Anthropic Messages API
    ▼
Local proxy — 127.0.0.1:17870
    ├─ codex-oauth   → ChatGPT/Codex backend (OAuth)
    ├─ gemini-oauth  → Google Code Assist / Gemini
    ├─ cline-pass    → Cline subscription
    ├─ openai        → OpenAI Responses API (key)
    ├─ gemini        → Gemini API (key)
    ├─ openrouter    → OpenRouter
    ├─ glm           → Z.AI Anthropic-compatible GLM
    └─ anthropic     → Anthropic passthrough
```

The proxy handles:

- **Content blocks** — text, images, tool use/results, thinking, redacted thinking
- **Streaming and non-streaming** replies
- **Tool conversion** for providers on OpenAI/Gemini tool schemas
- **Native server-side web search** for Codex/OpenAI and Gemini (Claude Code's
  local `WebSearch`/`WebFetch` are stripped so the provider searches instead)
- **Reasoning cache** — Codex encrypted-reasoning blobs are cached per session and
  replayed next turn so multi-step tasks keep their chain of thought
- **Internal-model remap** — Claude Code's own `haiku`/`sonnet` probes (title
  generation, Explore subagent, quota checks) route to the active provider's
  equivalent, so nothing needs an Anthropic key
- **Vision** — passthrough for Codex/OpenAI and Gemini; for GLM, images can be
  pre-described to text when `OPENROUTER_API_KEY` is set

---

## Runtime files

State lives under `~/.claude-proxy/` (created on first run):

```text
~/.claude-proxy/
├── .env                  # ccx API keys
├── codex-oauth.json      # ChatGPT/Codex tokens
├── google-oauth.json     # Google account 1
├── google-oauth-2.json   # Google account 2 (failover)
├── proxy.pid
└── proxy.log             # routing + upstream logs
```

---

## Project layout

```text
adapters/
├── anthropic-gateway.ts   # Fastify server + /v1/messages routing
├── map.ts                 # shortcuts + provider parsing
├── openai-auth.ts         # Codex OAuth
├── google-auth.ts         # Gemini OAuth
├── codex-reasoning-cache.ts
├── sse.ts · sse-aggregator.ts · vision-preprocess.ts · types.ts
└── providers/
    ├── codex-oauth.ts     # Anthropic → OpenAI Responses API
    ├── gemini-oauth.ts    ├── cline-pass.ts
    ├── openai-compat.ts   ├── openrouter.ts
    └── anthropic-pass.ts
bin/                       # launchers (claude-codex, claude-gemini, …) + lib/
tests/
```

Development:

```bash
npm test               # vitest
npm run start:proxy    # run the gateway directly (tsx)
npm run build          # tsc typecheck / emit
```

---

## Troubleshooting

**Proxy won't start / stale model.** A launcher reuses a running proxy, so config
changes need a restart:

```bash
claude-codex --restart          # or --stop, then relaunch
claude-codex --proxy-status     # shows the active provider:model
cat ~/.claude-proxy/proxy.log
```

If a non-proxy process holds the port, the launcher cleans it up via the PID lock
and an `lsof` fallback.

**OAuth looks stale.** Tokens auto-refresh, but you can force a clean login:

```bash
claude-codex --logout && claude-codex
claude-gemini --logout && claude-gemini
```

**`ccx` can't find keys.** `ccx --setup`, fill in `~/.claude-proxy/.env`, then
`ccx --restart`.

**`/model` didn't switch.** Use a shortcut from this README or an explicit route
(`/model codex@high`, `/model openrouter:some-org/some-model`), then watch the
routing line: `tail -f ~/.claude-proxy/proxy.log`.

---

## License

MIT — see [LICENSE](LICENSE).
