# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
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
- `adapters/codex-reasoning-cache.ts` — in-memory TTL cache keyed by first-user-turn hash
- `tests/codex-oauth.test.ts` — converter tests covering tools, messages, images, tool calls, thinking, and cache key derivation

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
