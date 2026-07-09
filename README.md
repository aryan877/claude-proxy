# Claude Proxy

Use Claude Code with Codex, Gemini, GLM, OpenRouter, Anthropic, and OpenAI API
routes through a local Anthropic-compatible proxy.

Claude Code still talks to `http://127.0.0.1:17870/v1/messages`. The proxy
translates Anthropic Messages requests into each provider's native format,
streams the response back as Anthropic SSE, and lets you switch providers with
Claude Code's `/model` command.

## TL;DR

```bash
# OAuth Codex route. Uses gpt-5.6-sol by default.
npm install -g claude-proxy-ai
claude-codex

# OAuth Gemini route. Uses gemini-3.1-pro-preview by default.
claude-gemini

# ClinePass route. Uses your paid Cline subscription. Defaults to glm-5.2.
claude-cline

# API-key multi-provider route. Uses glm-5 by default.
ccx --setup
ccx
```

For the older direct GLM wrapper installer:

```bash
npx claude-proxy-ai
```

That interactive installer creates `claude-glm` and shell aliases such as
`ccg`; it is separate from the npm global launcher commands.

## Install

`claude-proxy-ai` is intended to be used with `npx` or installed globally.
Local dependency installs are blocked by the package preinstall script.

```bash
npm install -g claude-proxy-ai
```

This exposes these global bins:

| Command | Default route | Auth |
| --- | --- | --- |
| `claude-codex` | `codex-oauth:gpt-5.6-sol` | OpenAI OAuth, or existing Codex CLI tokens |
| `claude-codex-d` | Same as `claude-codex` | Adds `--dangerously-skip-permissions` |
| `claude-gemini` | `gemini-oauth:gemini-3.1-pro-preview` | Google OAuth |
| `claude-gemini-d` | Same as `claude-gemini` | Adds `--dangerously-skip-permissions` |
| `claude-cline` | `cline-pass:glm-5.2` | Cline subscription (token from the Cline app) |
| `claude-cline-d` | Same as `claude-cline` | Adds `--dangerously-skip-permissions` |
| `ccx` | `glm:glm-5` | API keys in `~/.claude-proxy/.env` |
| `ccx-d` | Same as `ccx` | Adds `--dangerously-skip-permissions` |
| `claude-proxy-ai` | Interactive installer | Creates direct GLM wrapper scripts |

## Launchers

### `claude-codex`

Starts the proxy with the Codex OAuth route and launches Claude Code with the
`codex` shortcut. The current default model string in code is `gpt-5.6-sol`
(the GPT-5.6 frontier); `gpt-5.5` stays selectable via `/model gpt55`.

```bash
claude-codex
```

The launcher checks for OpenAI tokens in:

- `~/.claude-proxy/codex-oauth.json`
- `~/.codex/auth.json`

If neither exists, start the launcher and open the login URL it prints:

```bash
http://127.0.0.1:17870/codex/login
```

Useful flags:

```bash
claude-codex --status
claude-codex --logout
claude-codex --proxy-status
claude-codex --restart
claude-codex --stop
claude-codex -d
```

### `claude-gemini`

Starts the proxy with the Google OAuth route and launches Claude Code with the
`gemini` shortcut. The default model string is `gemini-3.1-pro-preview`.

```bash
claude-gemini
```

On first run, open:

```bash
http://127.0.0.1:17870/google/login
```

For automatic retry after a Google account hits a 429, link a second account
while the proxy is running:

```bash
http://127.0.0.1:17870/google/login/2
```

Tokens are stored in `~/.claude-proxy/google-oauth.json` and
`~/.claude-proxy/google-oauth-2.json`.

Useful flags:

```bash
claude-gemini --status
claude-gemini --logout
claude-gemini --proxy-status
claude-gemini --restart
claude-gemini --stop
claude-gemini -d
```

### `claude-cline`

Routes Claude Code through your paid **Cline / ClinePass** subscription
(`https://api.cline.bot`), so the included models cost `$0` per call. The OAuth
token is read live from the Cline app's
`~/.cline/data/settings/providers.json` — keep the Cline app signed in so it
keeps the 1-hour token refreshed. The default model is `glm-5.2`.

```bash
claude-cline
```

Models (all support thinking) — switch in-session with `/model`:

| Shortcut | Model | Shortcut | Model |
| --- | --- | --- | --- |
| `cp` · `glm52` | `glm-5.2` (default) | `cpminimax` | `minimax-m3` |
| `cpkimi` | `kimi-k2.7-code` | `cpdeepseek` | `deepseek-v4-pro` |
| `cpkimi26` | `kimi-k2.6` | `cpflash` | `deepseek-v4-flash` |
| `cpqwen` | `qwen3.7-max` | `cpmimo` | `mimo-v2.5-pro` |
| `cpqwenplus` | `qwen3.7-plus` | `cpmimo25` | `mimo-v2.5` |

Any model also works verbatim: `/model cline-pass:<id>`.

**Thinking levels** — append `@<level>` to any model: `none` / `minimal` (off,
fastest), `low`, `medium`, `high`, `xhigh` (deepest). Thinking is on by default.

```bash
/model cpkimi@high      # Kimi K2.7 Code, deep reasoning
/model cp@none          # GLM-5.2, thinking off
/model cpflash@minimal  # DeepSeek Flash, no thinking
```

Set a session-wide default level with `CLINE_REASONING_EFFORT` (e.g.
`CLINE_REASONING_EFFORT=none claude-cline`). Useful flags:

```bash
claude-cline --status
claude-cline --proxy-status
claude-cline --restart
claude-cline --stop
claude-cline -d
```

### `ccx`

Starts the API-key multi-provider route. By default, Claude Code launches with
`glm`, which maps to `glm:glm-5`.

```bash
ccx --setup
ccx
```

`ccx --setup` creates `~/.claude-proxy/.env`.

```bash
# OpenAI Responses API route
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_REFERER=
OPENROUTER_TITLE=Claude Code via ccx

# Gemini API-key route
GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta

# Z.AI GLM route
GLM_UPSTREAM_URL=https://api.z.ai/api/anthropic
ZAI_API_KEY=

# Anthropic passthrough route
ANTHROPIC_UPSTREAM_URL=https://api.anthropic.com
ANTHROPIC_API_KEY=
ANTHROPIC_VERSION=2023-06-01

# Local proxy
CLAUDE_PROXY_PORT=17870
```

`GLM_API_KEY` is also accepted as a fallback for `ZAI_API_KEY`.

Useful flags:

```bash
ccx --status
ccx --proxy-status
ccx --restart
ccx --stop
ccx -d
```

### `npx claude-proxy-ai`

Runs the interactive direct GLM installer for macOS, Linux, and Windows. It
creates a `claude-glm` wrapper under the user's bin directory and stores direct
Claude Code config in `~/.claude-glm`.

```bash
npx claude-proxy-ai
```

The Unix installer also adds aliases:

```bash
cc              # claude
ccg             # claude-glm
claude-d        # claude --dangerously-skip-permissions
claude-glm-d    # claude-glm --dangerously-skip-permissions
```

## Switching Models

Use Claude Code's `/model` command. Shortcuts are expanded by
`adapters/map.ts`; full provider routes also work.

```text
/model shortcut
/model provider:model-name
/model provider/model-name
```

### Provider Prefixes

| Prefix | Route |
| --- | --- |
| `codex-oauth` | OpenAI OAuth / ChatGPT Codex backend |
| `gemini-oauth` | Google OAuth / Code Assist Gemini route |
| `openai` | OpenAI Responses API with `OPENAI_API_KEY` |
| `gemini` | Gemini API with `GEMINI_API_KEY` |
| `openrouter` | OpenRouter with `OPENROUTER_API_KEY` |
| `glm` | Z.AI Anthropic-compatible GLM route |
| `anthropic` | Anthropic passthrough |

### Codex Shortcuts

Codex now routes to the **GPT-5.6 family** — Sol (frontier), Terra (balanced),
and Luna (fast/affordable). All three share a **372k-token context window**. Add
an `@level` suffix — `low | medium | high | xhigh | max` — to any of them.
(Upstream "ultra" is a multi-agent CLI orchestration mode, not a wire setting;
Codex itself sends it as `max`, so the proxy tops out at `max`.)

| Shortcut | Route |
| --- | --- |
| `codex`, `cx`, `sol`, `gpt56`, `gpt-5.6-sol` | `codex-oauth:gpt-5.6-sol` |
| `terra`, `gpt-5.6-terra` | `codex-oauth:gpt-5.6-terra` |
| `luna`, `gpt-5.6-luna` | `codex-oauth:gpt-5.6-luna` (supports up to `@max`; no `ultra` tier upstream) |
| `gpt55`, `gpt-5.5` | `codex-oauth:gpt-5.5` (previous frontier, 272k window) |
| `fast` | `codex-oauth:gpt-5.6-sol@low` |
| `smart` | `codex-oauth:gpt-5.6-sol@medium` |
| `deep` | `codex-oauth:gpt-5.6-sol@high` |
| `max`, `think` | `codex-oauth:gpt-5.6-sol@max` |

Examples:

```text
/model codex
/model terra@max
/model luna@high
/model codex@xhigh
/model codex-oauth:gpt-5.6-sol@low
```

### Gemini Shortcuts

| Shortcut | Route |
| --- | --- |
| `gemini`, `gemini-pro`, `gp` | `gemini-oauth:gemini-3.1-pro-preview` |
| `gemini-flash`, `gf` | `gemini-oauth:gemini-3-flash-preview` |
| `gemini-3p` | `gemini-oauth:gemini-3-pro-preview` |
| `gemini-31p` | `gemini-oauth:gemini-3.1-pro-preview` |
| `gemini-31f` | `gemini-oauth:gemini-3.1-flash-preview` |
| `gemini-25p` | `gemini-oauth:gemini-2.5-pro` |
| `gemini-25f` | `gemini-oauth:gemini-2.5-flash` |

Examples:

```text
/model gemini
/model gemini-flash@low
/model gemini-oauth:gemini-2.5-flash
/model gemini:gemini-2.5-flash
```

### GLM, OpenRouter, and Anthropic Shortcuts

| Shortcut | Route |
| --- | --- |
| `g`, `glm`, `glm5` | `glm:glm-5` |
| `glm47` | `glm:glm-4.7` |
| `glm45` | `glm:glm-4.5` |
| `flash` | `glm:glm-4-flash` |
| `glm5or` | `openrouter:z-ai/glm-5` |
| `minimax`, `mm`, `m25` | `openrouter:minimax/minimax-m2.5` |
| `opus` | `anthropic:claude-opus-4-8` |
| `sonnet` | `anthropic:claude-sonnet-5` |
| `haiku` | `anthropic:claude-haiku-4-5` |

Examples:

```text
/model glm
/model openrouter:anthropic/claude-sonnet-5
/model anthropic:claude-sonnet-5
```

## Reasoning

Append `@low`, `@medium`, `@high`, or `@xhigh` to supported model routes.

| Provider | Mapping |
| --- | --- |
| Codex / OpenAI route | `reasoning.effort` |
| Gemini 3.1 and Gemini Flash route | `thinkingLevel` |
| Gemini 3 Pro route | `LOW` or `HIGH` only; `medium` is raised to `HIGH` |
| Gemini 2.5 route | Thinking token budget |

Codex defaults to `@high` when no explicit reasoning level is provided. Gemini
defaults to full thinking through `claude-gemini`.

## Context Windows

`claude-codex` currently declares a 272,000 token context window to Claude Code
and auto-compacts at 95 percent of that window by default.

```bash
CODEX_CONTEXT_WINDOW_TOKENS=500000 claude-codex
CODEX_AUTO_COMPACT_WINDOW_TOKENS=475000 claude-codex
CODEX_DISABLE_COMPACT=1 claude-codex
```

`claude-gemini` declares a 1,000,000 token context window and disables Claude
Code auto-compact by default.

## How It Works

```text
Claude Code
    |
    | Anthropic Messages API
    v
Local proxy on 127.0.0.1:17870
    |
    +-- codex-oauth -> OpenAI ChatGPT/Codex backend with OAuth tokens
    +-- gemini-oauth -> Google Code Assist / Gemini
    +-- openai -> OpenAI Responses API with OPENAI_API_KEY
    +-- gemini -> Gemini API with GEMINI_API_KEY
    +-- openrouter -> OpenRouter
    +-- glm -> Z.AI Anthropic-compatible GLM endpoint
    +-- anthropic -> Anthropic passthrough
```

The proxy handles:

- Anthropic content blocks, including text, images, tool use/results, thinking,
  and redacted thinking.
- Streaming and non-streaming responses.
- Tool conversion for providers that use OpenAI or Gemini tool schemas.
- Native server-side web search for Codex/OpenAI and Gemini routes by stripping
  Claude Code's local `WebSearch`/`WebFetch` tools.
- Internal Claude model remapping so Claude Code title-generation or subagent
  probes keep using the active non-Anthropic provider when possible.
- Vision passthrough for Codex/OpenAI and Gemini routes. For GLM, images can be
  preprocessed into text descriptions when `OPENROUTER_API_KEY` is configured.

## Runtime Files

The proxy stores local runtime state under `~/.claude-proxy`.

```text
~/.claude-proxy/
|-- .env
|-- codex-oauth.json
|-- google-oauth.json
|-- google-oauth-2.json
|-- proxy.pid
`-- proxy.log
```

The direct GLM wrapper installer stores its separate Claude Code home under
`~/.claude-glm`.

## Source Layout

```text
adapters/
|-- anthropic-gateway.ts
|-- map.ts
|-- openai-auth.ts
|-- google-auth.ts
|-- providers/
|   |-- codex-oauth.ts
|   |-- gemini-oauth.ts
|   |-- openrouter.ts
|   `-- anthropic-pass.ts
bin/
|-- claude-codex.js
|-- claude-gemini.js
|-- ccx.js
|-- cli.js
`-- lib/
    |-- proxy-launcher.js
    `-- pid-manager.js
tests/
```

## Development

```bash
git clone https://github.com/aryan877/claude-proxy.git
cd claude-proxy
npm install
npm test
```

Run the proxy directly in development:

```bash
npm run start:proxy
```

Allow local package development if needed:

```bash
CLAUDE_PROXY_DEV=true npm install
```

## Troubleshooting

### Proxy will not start

```bash
claude-codex --proxy-status
claude-codex --restart
cat ~/.claude-proxy/proxy.log
```

If a non-proxy process is occupying the configured port, the launcher attempts
to clean it up with the PID lock and an `lsof` fallback.

### OAuth login looks stale

Tokens auto-refresh, but you can force a clean login:

```bash
claude-codex --logout
claude-codex

claude-gemini --logout
claude-gemini
```

### `ccx` cannot find API keys

Run:

```bash
ccx --setup
ccx --status
```

Then edit `~/.claude-proxy/.env` and restart the proxy:

```bash
ccx --restart
```

### `/model` does not switch routes

Use either a shortcut from this README or an explicit provider route:

```text
/model glm
/model codex@high
/model openrouter:some-org/some-model
```

Then check the routing line in:

```bash
tail -f ~/.claude-proxy/proxy.log
```

## License

MIT. See [LICENSE](LICENSE).
