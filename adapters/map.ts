// Provider parsing and message mapping utilities
import {
  AnthropicMessage,
  AnthropicRequest,
  ProviderKey,
  ProviderModel,
  ReasoningLevel,
} from "./types.js";

const VALID_REASONING: ReasoningLevel[] = ["none", "minimal", "low", "medium", "high", "xhigh"];

const PROVIDER_PREFIXES: ProviderKey[] = [
  "openai",
  "openrouter",
  "gemini",
  "gemini-oauth",
  "codex-oauth",
  "glm",
  "anthropic",
  "cline-pass",
];

// Model shortcuts - add your own aliases here
const MODEL_SHORTCUTS: Record<string, string> = {
  // GLM shortcuts
  g: "glm:glm-5",
  glm: "glm:glm-5",
  glm47: "glm:glm-4.7",
  glm45: "glm:glm-4.5",
  glm5: "glm:glm-5",
  glm5or: "openrouter:z-ai/glm-5",
  flash: "glm:glm-4-flash",
  // MiniMax shortcuts
  minimax: "openrouter:minimax/minimax-m2.5",
  mm: "openrouter:minimax/minimax-m2.5",
  m25: "openrouter:minimax/minimax-m2.5",
  // Claude shortcuts (for API users)
  opus: "anthropic:claude-opus-4-5-20251101",
  sonnet: "anthropic:claude-sonnet-4-6-20251114",
  haiku: "anthropic:claude-haiku-4-5-20251001",
  // Gemini OAuth shortcuts (Google account login)
  gemini: "gemini-oauth:gemini-3.1-pro-preview",
  "gemini-pro": "gemini-oauth:gemini-3.1-pro-preview",
  "gemini-flash": "gemini-oauth:gemini-3-flash-preview",
  "gemini-3p": "gemini-oauth:gemini-3-pro-preview",
  "gemini-31p": "gemini-oauth:gemini-3.1-pro-preview",
  "gemini-31f": "gemini-oauth:gemini-3.1-flash-preview",
  "gemini-25p": "gemini-oauth:gemini-2.5-pro",
  "gemini-25f": "gemini-oauth:gemini-2.5-flash",
  gp: "gemini-oauth:gemini-3.1-pro-preview",
  gf: "gemini-oauth:gemini-3-flash-preview",
  // Codex shortcuts — only gpt-5.5 (the frontier model). Switch by reasoning level.
  codex: "codex-oauth:gpt-5.5",          // proxy default = high
  cx: "codex-oauth:gpt-5.5",
  gpt55: "codex-oauth:gpt-5.5",
  "gpt-5.5": "codex-oauth:gpt-5.5",
  // Reasoning-level shortcuts (override @-suffix not needed)
  fast: "codex-oauth:gpt-5.5@low",       // quick, lighter reasoning
  smart: "codex-oauth:gpt-5.5@medium",   // Codex CLI default
  deep: "codex-oauth:gpt-5.5@high",      // proxy default
  max: "codex-oauth:gpt-5.5@xhigh",      // top reasoning
  think: "codex-oauth:gpt-5.5@xhigh",    // alias for max
  // ClinePass shortcuts (Cline subscription — included models, $0 per call)
  cline: "cline-pass:glm-5.2",
  clinepass: "cline-pass:glm-5.2",
  cp: "cline-pass:glm-5.2",
  cpglm: "cline-pass:glm-5.2",
  glm52: "cline-pass:glm-5.2",
  cpkimi: "cline-pass:kimi-k2.7-code",
  cpkimi26: "cline-pass:kimi-k2.6",
  cpqwen: "cline-pass:qwen3.7-max",
  cpqwenplus: "cline-pass:qwen3.7-plus",
  cpminimax: "cline-pass:minimax-m3",
  cpdeepseek: "cline-pass:deepseek-v4-pro",
  cpflash: "cline-pass:deepseek-v4-flash",
  cpmimo: "cline-pass:mimo-v2.5-pro",
  cpmimo25: "cline-pass:mimo-v2.5",
};

// When Claude Code internally sends claude-haiku-*/claude-sonnet-* requests
// (Explore subagent, title gen, quota checks), remap to the active provider's
// equivalent so it doesn't fail when Anthropic keys aren't configured.
const PROVIDER_FAST_MODEL: Partial<Record<ProviderKey, string>> = {
  "codex-oauth": "gpt-5.5",
  "gemini-oauth": "gemini-3-flash-preview",
  "openai": "gpt-5-mini",
  "openrouter": "anthropic/claude-haiku-4-5",
  "glm": "glm-4.5-air",
  "cline-pass": "glm-5.2",
};

const PROVIDER_MAIN_MODEL: Partial<Record<ProviderKey, string>> = {
  "codex-oauth": "gpt-5.5",
  "gemini-oauth": "gemini-3.1-pro-preview",
  "openai": "gpt-5.5",
  "openrouter": "anthropic/claude-sonnet-4-6",
  "glm": "glm-5",
  "cline-pass": "glm-5.2",
};

/**
 * Parse provider and model from the model field
 * Supports formats: "provider:model" or "provider/model"
 * Falls back to defaults if no valid prefix found
 */
export function parseProviderModel(
  modelField: string,
  defaults?: ProviderModel,
): ProviderModel {
  if (!modelField) {
    if (defaults) return defaults;
    throw new Error("Missing 'model' in request");
  }

  // Extract @reasoning suffix (e.g. "codex@high", "gemini@low")
  let reasoning: ReasoningLevel | undefined;
  let rawField = modelField;
  const atIdx = modelField.lastIndexOf("@");
  if (atIdx > 0) {
    const suffix = modelField.slice(atIdx + 1).toLowerCase() as ReasoningLevel;
    if (VALID_REASONING.includes(suffix)) {
      reasoning = suffix;
      rawField = modelField.slice(0, atIdx);
    }
  }

  // Expand shortcuts first
  let expanded = MODEL_SHORTCUTS[rawField.toLowerCase()] || rawField;

  // A shortcut may itself embed an @reasoning suffix (e.g. "fast" → "codex-oauth:gpt-5.5@low").
  // Re-extract so the suffix doesn't end up in the model slug. An explicit @reasoning typed
  // by the user wins over one baked into a shortcut.
  const expandedAtIdx = expanded.lastIndexOf("@");
  if (expandedAtIdx > 0) {
    const expandedSuffix = expanded.slice(expandedAtIdx + 1).toLowerCase() as ReasoningLevel;
    if (VALID_REASONING.includes(expandedSuffix)) {
      if (!reasoning) reasoning = expandedSuffix;
      expanded = expanded.slice(0, expandedAtIdx);
    }
  }

  // Auto-detect Claude models (start with "claude-") → route to anthropic,
  // OR remap to the active provider's equivalent when not using anthropic.
  // This handles Claude Code's internal haiku/sonnet calls (Explore subagent,
  // title generation, quota checks) that would otherwise fail through the proxy.
  if (expanded.toLowerCase().startsWith("claude-")) {
    if (defaults && defaults.provider !== "anthropic") {
      const lc = expanded.toLowerCase();
      const isOpus = lc.includes("opus");
      const fast = PROVIDER_FAST_MODEL[defaults.provider];
      const main = PROVIDER_MAIN_MODEL[defaults.provider];
      const remapped = isOpus ? (main || defaults.model) : (fast || defaults.model);
      console.log(`[ccx] Remapping internal Claude model "${expanded}" → ${defaults.provider}:${remapped}`);
      return { provider: defaults.provider, model: remapped, reasoning };
    }
    return { provider: "anthropic", model: expanded, reasoning };
  }

  // Auto-detect GLM models (start with "glm-") and route to glm
  if (expanded.toLowerCase().startsWith("glm-")) {
    return { provider: "glm", model: expanded, reasoning };
  }

  const sep = expanded.includes(":")
    ? ":"
    : expanded.includes("/")
      ? "/"
      : null;
  if (!sep) {
    const base = defaults ?? { provider: "glm" as ProviderKey, model: expanded };
    return { ...base, reasoning: reasoning ?? base.reasoning };
  }

  const [maybeProv, ...rest] = expanded.split(sep);
  const prov = maybeProv.toLowerCase() as ProviderKey;

  if (!PROVIDER_PREFIXES.includes(prov)) {
    const base = defaults ?? { provider: "glm" as ProviderKey, model: expanded };
    return { ...base, reasoning: reasoning ?? base.reasoning };
  }

  return { provider: prov, model: rest.join(sep), reasoning };
}

/**
 * Warn if tools are being used with providers that may not support them
 */
export function warnIfTools(
  req: AnthropicRequest,
  provider: ProviderKey,
): void {
  if (req.tools && req.tools.length > 0) {
    // GLM, Anthropic, Gemini OAuth, and Codex OAuth support tools natively
    if (provider !== "glm" && provider !== "anthropic" && provider !== "gemini-oauth" && provider !== "codex-oauth") {
      console.warn(
        `[proxy] Warning: ${provider} may not fully support Anthropic-style tools. Passing through anyway.`,
      );
    }
  }
}

/**
 * Convert Anthropic content to plain text
 */
export function toPlainText(content: AnthropicMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((c) => {
      if (typeof c === "string") return c;
      if (c.type === "text") return c.text;
      if (c.type === "tool_result") {
        // Convert tool results to text representation
        if (typeof c.content === "string") return c.content;
        return JSON.stringify(c.content);
      }
      return "";
    })
    .join("");
}

/**
 * Convert Anthropic messages to OpenAI format
 */
export function toOpenAIMessages(messages: AnthropicMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content: toPlainText(m.content),
  }));
}

/**
 * Convert Anthropic messages to Gemini format
 */
export function toGeminiContents(messages: AnthropicMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: toPlainText(m.content) }],
  }));
}
