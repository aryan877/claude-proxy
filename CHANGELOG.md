# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **ClinePass auth** — the proxy now refreshes the ClinePass access token itself instead of trusting the Cline app to keep `providers.json` fresh. ClinePass access tokens only live ~1 hour, so once the app/hub-daemon stopped refreshing, every `cp*` call (and `/model cp@high`, `/model cp@medium`, …) failed with `401 Unauthorized: Please make sure you're using the latest version of Cline…`. The adapter now:
  - detects an expired/near-expiry token (5-min skew) and refreshes via `POST /api/v1/auth/refresh` (`{refreshToken, grantType:"refresh_token"}`) using the stored refresh token
  - persists the rotated `accessToken`/`refreshToken`/`expiresAt` back into every `cline*` entry of `providers.json` atomically (temp file + rename)
  - re-applies the required `workos:` token prefix (the API 401s on a bare JWT)
  - dedupes concurrent refreshes and retries once on an upstream 401 (token revoked mid-validity)

### Changed
- **Claude shortcuts updated for the Claude 5 family** — `sonnet` now maps to `anthropic:claude-sonnet-5` (was `claude-sonnet-4-6-20251114`) and `opus` to `anthropic:claude-opus-4-8` (was `claude-opus-4-5-20251101`); `haiku` uses the bare `claude-haiku-4-5` alias (dropped the dated suffix). The internal subagent remap already routed Claude Code's `claude-sonnet-5` calls to each provider's equivalent (e.g. `codex-oauth:gpt-5.5`), so Codex/Gemini/GLM subagents keep working; this only refreshes the typeable `/model` aliases and the OpenRouter main-model fallback (`anthropic/claude-sonnet-5`).
- Codex adapter rewritten to match the real Codex CLI wire format 1:1
  - Always POSTs to `/v1/responses` (both OAuth and API key paths) — never `/v1/chat/completions`
  - Sends `originator: codex_cli_rs`, `User-Agent: codex_cli_rs/<ver> (<os> <ver>; <arch>)`, and `x-codex-installation-id` headers like the real CLI
  - Adds `parallel_tool_calls`, `tool_choice`, `prompt_cache_key`, `include: ["reasoning.encrypted_content"]`, `store: false`, and optional `text.verbosity` to the request body
  - `tool_choice: any` → `required`, `tool_choice: tool` → `{type: "function", name}`
  - Streams `tool_use` content blocks incrementally as `input_json_delta` (no longer buffered until end of stream)
  - Splits `thinking` content blocks vs `text` content blocks during streaming so Claude Code's UI renders reasoning correctly
  - Emits real `input_tokens`, `output_tokens`, and `cache_read_input_tokens` from the upstream usage payload
- Codex now accepts Claude Code's full Anthropic content surface: `text`, `image` (base64 + URL), `tool_use`, `tool_result`, `thinking`, `redacted_thinking`
- Encrypted reasoning blobs are cached per session and re-injected on the next turn so multi-step tasks keep their chain of thought
- Web search is forced on for Codex by registering the native `{type: "web_search"}` tool — Claude Code's `WebSearch`/`WebFetch` tools are stripped because Codex executes search server-side

### Added
- **ClinePass provider** (`cline-pass`) — route Claude Code through a paid Cline / ClinePass subscription (`https://api.cline.bot/api/v1`), included models cost `$0` per call
  - `claude-cline` / `claude-cline-d` launchers; default model `glm-5.2`
  - OAuth token read live from the Cline app's `~/.cline/data/settings/providers.json`, and auto-refreshed by the proxy when expired (see Fixed below)
  - 10 models with shortcuts: `cp`/`glm52`, `cpkimi`, `cpkimi26`, `cpqwen`, `cpqwenplus`, `cpminimax`, `cpdeepseek`, `cpflash`, `cpmimo`, `cpmimo25`
  - `CLINE_REASONING_EFFORT` / `CLINE_API_BASE_URL` / `CLINE_PROVIDERS_PATH` env overrides
- `adapters/providers/openai-compat.ts` — shared OpenAI-compatible Anthropic↔OpenAI streamer; `openrouter` now delegates to it
- `adapters/codex-reasoning-cache.ts` — in-memory TTL cache keyed by first-user-turn hash
- `tests/codex-oauth.test.ts` — converter tests covering tools, messages, images, tool calls, thinking, and cache key derivation

### Changed
- Reasoning levels now include `none` and `minimal` (thinking off) alongside `low`/`medium`/`high`/`xhigh`; ClinePass passes the full set through natively, Codex floors `none`/`minimal` to `low`, Gemini 3 maps them to its lowest thinking level

## [1.0.3] - 2025-10-01

### Changed
- Removed global installation support - npx only
- Updated preinstall script to block ALL installation methods (local and global)
- Clearer error messaging emphasizing npx as the only supported method

## [1.0.2] - 2025-10-01

### Added
- Preinstall check to prevent incorrect installation method
- Error message directing users to use `npx` instead of `npm i`
- Support for global installation with `-g` flag

### Changed
- Installation now blocks when users try `npm i claude-glm-installer` locally
- Improved user guidance for correct installation method

## [1.0.1] - 2025-10-01

### Changed
- Updated package description to include npx usage instructions
- Clarified installation method in npm package listing

## [1.0.0] - 2025-10-01

### Added
- Windows PowerShell support with full feature parity
- Cross-platform npm package installer (`npx claude-glm-installer`)
- Automatic detection and cleanup of old wrapper installations
- GLM-4.6 model support as new default
- GLM-4.5 wrapper (ccg45) for backward compatibility
- Universal bootstrap script for OS auto-detection
- Comprehensive Windows documentation and troubleshooting
- Platform-specific installation paths and configuration
- Bash installer for Unix/Linux/macOS
- Support for GLM-4.5 and GLM-4.5-Air models
- Isolated configuration directories per model
- Shell aliases (ccg, ccg45, ccf, cc)
- No sudo/admin required installation
- Wrapper scripts in ~/.local/bin
- Z.AI API key integration
- Separate chat histories per model
- Error reporting system with GitHub issue integration
- Test mode for error reporting (`--test-error` flag)
- Debug mode (`--debug` flag)
- User consent prompts for error reporting

### Changed
- Updated default model from GLM-4.5 to GLM-4.6
- Renamed aliases: removed `cca`, kept `cc` for regular Claude
- Improved installation flow with old wrapper detection
- Enhanced README with collapsible platform-specific sections
- Updated cross-platform support documentation

### Fixed
- PATH conflicts when multiple wrapper installations exist
- Version mismatches from old wrapper files
- Installation detection across different locations
- PowerShell parsing errors when piping through `iex`
- Nested here-string issues in PowerShell
- Subexpression parsing errors in piped contexts
- Terminal/PowerShell window persistence after errors

[Unreleased]: https://github.com/JoeInnsp23/claude-glm-wrapper/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/JoeInnsp23/claude-glm-wrapper/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/JoeInnsp23/claude-glm-wrapper/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/JoeInnsp23/claude-glm-wrapper/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/JoeInnsp23/claude-glm-wrapper/releases/tag/v1.0.0
