// Codex adapter — Anthropic Messages API → OpenAI Responses API (/v1/responses)
//
// Mirrors what the real Codex CLI sends on the wire. References:
//   codex-rs/core/src/client.rs::build_responses_request
//   codex-rs/codex-api/src/common.rs::ResponsesApiRequest
//   codex-rs/codex-api/src/sse/responses.rs
//   codex-rs/login/src/auth/default_client.rs (originator / User-Agent)
//   codex-rs/model-provider/src/bearer_auth_provider.rs (ChatGPT-Account-ID)
//
// Wire decisions:
//   - Always POST to /v1/responses (OAuth → ChatGPT backend, API key → api.openai.com).
//     Codex CLI does NOT use /v1/chat/completions. Wire format is responses-only.
//   - Stream tools/text/reasoning incrementally as Anthropic SSE events.
//   - Cache encrypted_content reasoning blobs per session and re-inject on next turn.

import { readFileSync } from "fs";
import { homedir, release, arch, type } from "os";
import { join } from "path";
import type { EventSourceMessage } from "eventsource-parser";
import { createParser } from "eventsource-parser";
import { FastifyReply } from "fastify";
import { getCodexAccessToken, getCodexAccountId } from "../openai-auth.js";
import { sendEvent } from "../sse.js";
import {
  conversationKey,
  reasoningItems,
  setReasoningItems,
  threadIdFor,
} from "../codex-reasoning-cache.js";
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicTool,
  AnthropicToolChoice,
  ReasoningLevel,
} from "../types.js";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const CHATGPT_CODEX_BASE = "https://chatgpt.com/backend-api/codex";

const DEFAULT_ORIGINATOR = "codex_cli_rs";
const DEFAULT_CODEX_CLI_VERSION = "0.144.0";

// ── Header builders ──────────────────────────────────────────────────

function installationId(): string {
  try {
    return readFileSync(join(homedir(), ".codex", "installation_id"), "utf-8").trim();
  } catch {
    return "";
  }
}

/** Build the User-Agent string Codex CLI sends. Matches `get_codex_user_agent()`. */
function codexUserAgent(): string {
  const version = process.env.CODEX_CLI_VERSION || DEFAULT_CODEX_CLI_VERSION;
  return `${DEFAULT_ORIGINATOR}/${version} (${type()} ${release()}; ${arch()})`;
}

// ── Tool conversion (Anthropic → Responses API) ──────────────────────

type ResponsesTool =
  | {
      type: "function";
      name: string;
      description: string;
      strict: false;
      parameters: unknown;
    }
  | {
      type: "web_search";
      search_context_size?: "low" | "medium" | "high";
    };

export function toResponsesTools(tools: AnthropicTool[] | undefined): ResponsesTool[] {
  const out: ResponsesTool[] = [];
  if (tools) {
    for (const t of tools) {
      out.push({
        type: "function",
        name: t.name,
        description: t.description ?? "",
        strict: false,
        parameters: t.input_schema ?? { type: "object", properties: {} },
      });
    }
  }
  // Codex CLI registers native web_search; Claude Code's WebSearch/WebFetch are stripped
  // upstream in anthropic-gateway.ts before they reach us.
  out.push({ type: "web_search" });
  return out;
}

export function toResponsesToolChoice(c?: AnthropicToolChoice): string | { type: string; name?: string } {
  if (!c || c.type === "auto") return "auto";
  if (c.type === "any") return "required";
  if (c.type === "none") return "none";
  if (c.type === "tool") return { type: "function", name: c.name };
  return "auto";
}

// ── Input conversion (Anthropic messages → Responses ResponseItem[]) ──

type ResponseMessageContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: "auto" | "low" | "high" }
  | { type: "output_text"; text: string };

export type ReasoningResponseItem = {
  type: "reasoning";
  summary: Array<{ type: "summary_text"; text: string }>;
  encrypted_content?: string | null;
};

export type ResponseItem =
  | {
      type: "message";
      role: "user" | "assistant" | "system" | "developer";
      content: ResponseMessageContent[];
    }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | ReasoningResponseItem;

export function textFromResponsesMessageItem(item: {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
}): string {
  if (item.type !== "message" || !Array.isArray(item.content)) return "";
  return item.content
    .map((part) => (part.type === "output_text" || part.type === "text" ? part.text || "" : ""))
    .filter(Boolean)
    .join("");
}

function flattenSystem(system: AnthropicRequest["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system
    .map((b) => (typeof b === "string" ? b : (b as { text?: string }).text || ""))
    .filter(Boolean)
    .join("\n");
}

function previewText(text: string, max = 160): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function responseItemSummary(item: ResponseItem | undefined): string {
  if (!item) return "none";
  if (item.type === "message") {
    const text = item.content
      .map((part) => ("text" in part ? part.text : part.image_url ? "[image]" : ""))
      .filter(Boolean)
      .join(" ");
    return `message:${item.role}:${previewText(text)}`;
  }
  if (item.type === "function_call") {
    return `function_call:${item.name}:${item.call_id}`;
  }
  if (item.type === "function_call_output") {
    return `function_call_output:${item.call_id}:${previewText(item.output)}`;
  }
  return `reasoning:encrypted=${item.encrypted_content ? "yes" : "no"} summaries=${item.summary.length}`;
}

function imageUrlForBlock(block: Extract<AnthropicContentBlock, { type: "image" }>): string {
  const s = block.source;
  if (s.type === "base64") return `data:${s.media_type};base64,${s.data}`;
  if (s.type === "url") return s.url;
  return "";
}

function stringifyToolResult(content: string | AnthropicContentBlock[]): string {
  if (typeof content === "string") return content;
  // Anthropic allows tool_result content to be a list of blocks. Codex/OpenAI
  // function_call_output.output is a plain string, so flatten text + JSON-encode the rest.
  return content
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "image") return `[image: ${(b as { source: { media_type?: string } }).source.media_type || "unknown"}]`;
      return JSON.stringify(b);
    })
    .join("\n");
}

// Codex's ChatGPT backend rejects input items with role "system"
// ({"detail":"System messages are not allowed"}). Claude Code 2.1.156+ sends
// MCP/skill instructions as a role:"system" message inside `messages`, so map any
// non-user/assistant role to "developer" — the Responses API's system-level role.
function toInputRole(role: AnthropicMessage["role"]): "user" | "assistant" | "developer" {
  if (role === "assistant") return "assistant";
  if (role === "user") return "user";
  return "developer";
}

function trailingDeveloperMessageCount(messages: AnthropicMessage[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (toInputRole(messages[i].role) !== "developer") break;
    count += 1;
  }
  return count;
}

export function normalizeMessagesForResponses(messages: AnthropicMessage[]): AnthropicMessage[] {
  const trailingCount = trailingDeveloperMessageCount(messages);
  if (trailingCount === 0 || trailingCount === messages.length) return messages;

  const split = messages.length - trailingCount;
  const finalActionable = messages[split - 1];
  return [
    ...messages.slice(0, split - 1),
    ...messages.slice(split),
    finalActionable,
  ];
}

export function toResponsesInput(
  messages: AnthropicMessage[],
  injectedReasoning: ResponseItem[] = [],
): ResponseItem[] {
  const out: ResponseItem[] = [];
  // Encrypted reasoning carries the prior turn's chain of thought; inject before the new user turn.
  out.push(...injectedReasoning);

  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({
        type: "message",
        role: toInputRole(m.role),
        content: [
          m.role === "assistant"
            ? { type: "output_text", text: m.content }
            : { type: "input_text", text: m.content },
        ],
      });
      continue;
    }

    const inlineContent: ResponseMessageContent[] = [];
    const trailingItems: ResponseItem[] = [];
    for (const block of m.content as AnthropicContentBlock[]) {
      switch (block.type) {
        case "text":
          inlineContent.push(
            m.role === "assistant"
              ? { type: "output_text", text: block.text }
              : { type: "input_text", text: block.text },
          );
          break;
        case "image":
          inlineContent.push({ type: "input_image", image_url: imageUrlForBlock(block) });
          break;
        case "tool_use":
          trailingItems.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments:
              typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
          });
          break;
        case "tool_result":
          trailingItems.push({
            type: "function_call_output",
            call_id: block.tool_use_id,
            output: stringifyToolResult(block.content),
          });
          break;
        case "thinking":
        case "redacted_thinking":
          // Claude Code may replay historical Anthropic thinking blocks on every
          // turn. They are not reusable Codex reasoning state; the only reasoning
          // we should echo back is the encrypted_content returned by Responses
          // and stored in our cache. Re-sending thinking summaries here can make
          // long resumed sessions exceed the upstream context window.
          break;
      }
    }

    if (inlineContent.length) {
      out.push({ type: "message", role: toInputRole(m.role), content: inlineContent });
    }
    if (trailingItems.length) out.push(...trailingItems);
  }

  return out;
}

// ── Reasoning effort mapping ─────────────────────────────────────────

function reasoningEffort(level?: ReasoningLevel): "low" | "medium" | "high" | "xhigh" | "max" {
  if (level === "none" || level === "minimal") return "low"; // Codex has no thinking-off; floor to low
  if (level) return level; // low | medium | high | xhigh | max pass straight through
  // Codex maps its client-only "ultra" effort to "max" on the wire (multi-agent
  // orchestration is a CLI concern, not a Responses param), so "max" is the ceiling
  // the proxy ever sends. GPT-5.6 Sol/Terra/Luna accept it; older models cap at xhigh.
  const env = (process.env.CODEX_REASONING_EFFORT || "").toLowerCase();
  if (env === "low" || env === "medium" || env === "high" || env === "xhigh" || env === "max") return env;
  return "high";
}

function reasoningSummary(): "auto" | "concise" | "detailed" | null {
  const env = (process.env.CODEX_REASONING_SUMMARY || "").toLowerCase();
  if (env === "concise" || env === "detailed" || env === "auto") return env;
  if (env === "none") return null;
  return "auto";
}

function textVerbosity(): "low" | "medium" | "high" | undefined {
  const env = (process.env.CODEX_TEXT_VERBOSITY || "").toLowerCase();
  if (env === "low" || env === "medium" || env === "high") return env;
  return undefined;
}

// ── Main adapter ─────────────────────────────────────────────────────

export async function chatCodexOAuth(
  res: FastifyReply,
  body: AnthropicRequest,
  model: string,
  apiKey?: string,
  reasoning?: ReasoningLevel,
) {
  try {
    await chatCodexOAuthInner(res, body, model, apiKey, reasoning);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[codex] ERROR: ${message}`);
    emitErrorAsSse(res, model, message);
  }
}

function emitErrorAsSse(res: FastifyReply, model: string, message: string) {
  if (res.raw.writableEnded) return;
  try {
    const id = `msg_${Date.now()}`;
    sendEvent(res, "message_start", {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    sendEvent(res, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    sendEvent(res, "content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: `[codex proxy error] ${message}` },
    });
    sendEvent(res, "content_block_stop", { type: "content_block_stop", index: 0 });
    sendEvent(res, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 0 },
    });
    sendEvent(res, "message_stop", { type: "message_stop" });
    res.raw.end();
  } catch {
    /* stream already closed */
  }
}

// undici wraps every connection-level failure as a bare `TypeError: fetch failed`,
// hiding the real reason (ECONNRESET from a stale keep-alive socket, connect
// timeout, DNS blip). Unwrap `.cause` so logs and the surfaced error say why.
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return code ? `${err.message} (${code})` : `${err.message} (${cause.message})`;
  }
  return err.message;
}

// `fetch()` only throws on connection-level failures — an HTTP error status comes
// back as a resolved Response — so a throw means the request never reached the
// server and re-POSTing the identical body is safe (Codex requests use store:false).
// The dominant cause is a pooled keep-alive socket the backend already closed;
// the failing attempt errors instantly and the retry gets a fresh connection.
async function fetchCodexWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const backoffMs = 250 * attempt;
        console.error(
          `[codex] upstream connect failed (attempt ${attempt}/${attempts}): ${describeFetchError(err)} — retrying in ${backoffMs}ms`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }
  throw new Error(describeFetchError(lastErr));
}

async function chatCodexOAuthInner(
  res: FastifyReply,
  body: AnthropicRequest,
  model: string,
  apiKey?: string,
  reasoning?: ReasoningLevel,
) {
  const isOAuth = !apiKey;
  const accessToken = apiKey ?? (await getCodexAccessToken());
  const url = isOAuth
    ? `${CHATGPT_CODEX_BASE}/responses`
    : `${OPENAI_API_BASE}/responses`;

  const messages = normalizeMessagesForResponses(body.messages);
  const trailingDeveloperMoved = messages === body.messages ? 0 : trailingDeveloperMessageCount(body.messages);
  const convoKey = conversationKey(messages);
  const reasoningCacheDisabled = process.env.CCX_DISABLE_REASONING_CACHE === "1";
  const cachedReasoning = reasoningCacheDisabled ? [] : (reasoningItems(convoKey) as ResponseItem[]);
  const promptCacheKey = threadIdFor(convoKey);

  const input = toResponsesInput(messages, cachedReasoning);
  const tools = toResponsesTools(body.tools);
  const verbosity = textVerbosity();
  const summary = reasoningSummary();
  const instructions = flattenSystem(body.system);

  // ── Build request body (matches ResponsesApiRequest in codex-rs/codex-api/src/common.rs) ──
  const reqBody: Record<string, unknown> = {
    model,
    instructions,
    input,
    tools,
    tool_choice: toResponsesToolChoice(body.tool_choice),
    parallel_tool_calls: false,
    reasoning: { effort: reasoningEffort(reasoning), ...(summary ? { summary } : {}) },
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: promptCacheKey,
  };
  if (verbosity) reqBody.text = { verbosity };

  const installId = installationId();
  if (installId) {
    reqBody.client_metadata = { "x-codex-installation-id": installId };
  }

  // ── Headers ──
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    originator: DEFAULT_ORIGINATOR,
    "User-Agent": codexUserAgent(),
    "OpenAI-Beta": "responses=experimental",
  };
  if (installId) headers["x-codex-installation-id"] = installId;
  if (isOAuth) {
    const accountId = getCodexAccountId();
    if (accountId) headers["ChatGPT-Account-ID"] = accountId;
  }

  const reqJson = JSON.stringify(reqBody);
  const reasoningInputCount = input.filter((item) => item.type === "reasoning").length;
  const functionCallCount = input.filter((item) => item.type === "function_call").length;
  const functionOutputCount = input.filter((item) => item.type === "function_call_output").length;
  const lastInput = responseItemSummary(input.at(-1));

  console.log(
    `[codex] ${isOAuth ? "ChatGPT" : "API"} | model="${model}" messages=${messages.length} systemChars=${instructions.length} items=${input.length} tools=${tools.length} reasoning=${reasoningEffort(reasoning)} cache=${cachedReasoning.length}${reasoningCacheDisabled ? " cacheDisabled=1" : ""} movedTrailingDeveloper=${trailingDeveloperMoved} reqKiB=${(reqJson.length / 1024).toFixed(1)} reasoningItems=${reasoningInputCount} fnCalls=${functionCallCount} fnOutputs=${functionOutputCount} last=${JSON.stringify(lastInput)}`,
  );

  const upstream = await fetchCodexWithRetry(url, {
    method: "POST",
    headers,
    body: reqJson,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "<no-body>");
    throw new Error(`OpenAI ${upstream.status}: ${text.slice(0, 500)}`);
  }

  await pumpResponsesStream(res, upstream.body, model, convoKey);
}

// ── SSE pump: Responses API events → Anthropic SSE events ────────────

type StreamState = {
  msgId: string;
  messageStarted: boolean;
  thinkingOpen: boolean;
  textOpen: boolean;
  blockIndex: number;
  funcCallByItemId: Map<string, { blockIndex: number; name: string; callId: string }>;
  newReasoningItems: ReasoningResponseItem[];
  textChars: number;
  thinkingChars: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
};

function makeState(): StreamState {
  return {
    msgId: `msg_${Date.now()}`,
    messageStarted: false,
    thinkingOpen: false,
    textOpen: false,
    blockIndex: 0,
    funcCallByItemId: new Map(),
    newReasoningItems: [],
    textChars: 0,
    thinkingChars: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    stopReason: "end_turn",
  };
}

function ensureMessageStarted(res: FastifyReply, s: StreamState, model: string) {
  if (s.messageStarted) return;
  s.messageStarted = true;
  sendEvent(res, "message_start", {
    type: "message_start",
    message: {
      id: s.msgId,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
}

function openThinking(res: FastifyReply, s: StreamState, model: string) {
  if (s.thinkingOpen) return;
  ensureMessageStarted(res, s, model);
  closeText(res, s);
  s.thinkingOpen = true;
  sendEvent(res, "content_block_start", {
    type: "content_block_start",
    index: s.blockIndex,
    content_block: { type: "thinking", thinking: "" },
  });
}

function closeThinking(res: FastifyReply, s: StreamState) {
  if (!s.thinkingOpen) return;
  sendEvent(res, "content_block_stop", { type: "content_block_stop", index: s.blockIndex });
  s.thinkingOpen = false;
  s.blockIndex += 1;
}

function openText(res: FastifyReply, s: StreamState, model: string) {
  if (s.textOpen) return;
  ensureMessageStarted(res, s, model);
  closeThinking(res, s);
  s.textOpen = true;
  sendEvent(res, "content_block_start", {
    type: "content_block_start",
    index: s.blockIndex,
    content_block: { type: "text", text: "" },
  });
}

function closeText(res: FastifyReply, s: StreamState) {
  if (!s.textOpen) return;
  sendEvent(res, "content_block_stop", { type: "content_block_stop", index: s.blockIndex });
  s.textOpen = false;
  s.blockIndex += 1;
}

function emitTextDelta(res: FastifyReply, s: StreamState, model: string, text: string) {
  if (!text) return;
  openText(res, s, model);
  s.textChars += text.length;
  sendEvent(res, "content_block_delta", {
    type: "content_block_delta",
    index: s.blockIndex,
    delta: { type: "text_delta", text },
  });
}

async function pumpResponsesStream(
  res: FastifyReply,
  body: ReadableStream<Uint8Array>,
  model: string,
  convoKey: string,
) {
  const s = makeState();

  const parser = createParser({
    onEvent: (ev: EventSourceMessage) => {
      if (!ev.data || ev.data === "[DONE]") return;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleEvent(res, s, model, json);
    },
  });

  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    if (!s.messageStarted) throw err;
    if (!s.funcCallByItemId.size) {
      emitTextDelta(
        res,
        s,
        model,
        `[codex proxy error] ${describeFetchError(err)}`,
      );
    }
    finalize(res, s, model, convoKey);
    return;
  }
  finalize(res, s, model, convoKey);
}

function finalize(res: FastifyReply, s: StreamState, model: string, convoKey: string) {
  ensureMessageStarted(res, s, model);
  closeThinking(res, s);
  closeText(res, s);
  for (const { blockIndex } of s.funcCallByItemId.values()) {
    sendEvent(res, "content_block_stop", { type: "content_block_stop", index: blockIndex });
  }
  s.funcCallByItemId.clear();

  if (s.newReasoningItems.length) setReasoningItems(convoKey, s.newReasoningItems);

  console.log(
    `[codex] stream done textChars=${s.textChars} thinkingChars=${s.thinkingChars} toolCalls=${s.toolCalls} input=${s.inputTokens} output=${s.outputTokens} cacheRead=${s.cacheReadInputTokens} stop=${s.stopReason}`,
  );

  sendEvent(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: s.stopReason, stop_sequence: null },
    usage: {
      input_tokens: s.inputTokens,
      output_tokens: s.outputTokens,
      cache_creation_input_tokens: s.cacheCreationInputTokens,
      cache_read_input_tokens: s.cacheReadInputTokens,
    },
  });
  sendEvent(res, "message_stop", { type: "message_stop" });
  if (!res.raw.writableEnded) res.raw.end();
}

function handleEvent(
  res: FastifyReply,
  s: StreamState,
  model: string,
  json: Record<string, unknown>,
) {
  const type = json.type as string | undefined;
  if (!type) return;

  switch (type) {
    case "response.created":
      return;

    case "response.output_text.delta": {
      const delta = json.delta as string | undefined;
      if (!delta) return;
      emitTextDelta(res, s, model, delta);
      return;
    }

    case "response.output_text.done": {
      // Some Responses streams only expose the full text in the done event.
      // Avoid duplicating normal delta streams by using this as a fallback.
      const text = json.text as string | undefined;
      if (text && s.textChars === 0) emitTextDelta(res, s, model, text);
      return;
    }

    case "response.content_part.done": {
      const part = json.part as { type?: string; text?: string } | undefined;
      const text = part?.type === "output_text" || part?.type === "text" ? part.text : "";
      if (text && s.textChars === 0) emitTextDelta(res, s, model, text);
      return;
    }

    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta": {
      const delta = json.delta as string | undefined;
      if (!delta) return;
      openThinking(res, s, model);
      s.thinkingChars += delta.length;
      sendEvent(res, "content_block_delta", {
        type: "content_block_delta",
        index: s.blockIndex,
        delta: { type: "thinking_delta", thinking: delta },
      });
      return;
    }

    case "response.reasoning_summary_part.added":
      // Soft paragraph break between summary parts to keep them readable inside one thinking block.
      if (s.thinkingOpen) {
        sendEvent(res, "content_block_delta", {
          type: "content_block_delta",
          index: s.blockIndex,
          delta: { type: "thinking_delta", thinking: "\n\n" },
        });
      }
      return;

    case "response.output_item.added": {
      const item = json.item as
        | { type?: string; id?: string; call_id?: string; name?: string }
        | undefined;
      if (!item) return;
      if (item.type === "function_call") {
        ensureMessageStarted(res, s, model);
        closeText(res, s);
        closeThinking(res, s);
        const callId = item.call_id || item.id || `call_${Date.now()}`;
        const name = item.name || "";
        s.funcCallByItemId.set(item.id || callId, {
          blockIndex: s.blockIndex,
          name,
          callId,
        });
        s.toolCalls += 1;
        sendEvent(res, "content_block_start", {
          type: "content_block_start",
          index: s.blockIndex,
          content_block: { type: "tool_use", id: callId, name, input: {} },
        });
        s.blockIndex += 1;
        s.stopReason = "tool_use";
      } else if (item.type === "web_search_call") {
        console.log(`[codex] web_search invoked`);
      }
      return;
    }

    case "response.function_call_arguments.delta": {
      const itemId = (json.item_id || json.id) as string | undefined;
      const delta = json.delta as string | undefined;
      if (!itemId || !delta) return;
      const entry = s.funcCallByItemId.get(itemId);
      if (!entry) return;
      sendEvent(res, "content_block_delta", {
        type: "content_block_delta",
        index: entry.blockIndex,
        delta: { type: "input_json_delta", partial_json: delta },
      });
      return;
    }

    case "response.function_call_arguments.done":
      // Full arguments string is already streamed via deltas. output_item.done closes the block.
      return;

    case "response.output_item.done": {
      const item = json.item as
        | {
            type?: string;
            id?: string;
            call_id?: string;
            name?: string;
            arguments?: string;
            content?: Array<{ type?: string; text?: string }>;
            summary?: Array<{ type: string; text: string }>;
            encrypted_content?: string | null;
          }
        | undefined;
      if (!item) return;

      if (item.type === "function_call") {
        const itemId = item.id || item.call_id || "";
        const entry = s.funcCallByItemId.get(itemId);
        if (entry) {
          sendEvent(res, "content_block_stop", {
            type: "content_block_stop",
            index: entry.blockIndex,
          });
          s.funcCallByItemId.delete(itemId);
        }
      } else if (item.type === "reasoning") {
        s.newReasoningItems.push({
          type: "reasoning",
          summary: (item.summary ?? []).map((p) => ({
            type: "summary_text",
            text: p.text,
          })),
          encrypted_content: item.encrypted_content ?? null,
        });
      } else if (item.type === "message" && s.textChars === 0) {
        emitTextDelta(res, s, model, textFromResponsesMessageItem(item));
      }
      return;
    }

    case "response.completed": {
      const resp = json.response as
        | {
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              input_tokens_details?: { cached_tokens?: number };
            };
            end_turn?: boolean;
          }
        | undefined;
      const u = resp?.usage;
      if (u) {
        s.inputTokens = u.input_tokens ?? 0;
        s.outputTokens = u.output_tokens ?? 0;
        s.cacheReadInputTokens = u.input_tokens_details?.cached_tokens ?? 0;
      }
      return;
    }

    case "response.failed":
    case "response.incomplete": {
      const resp = json.response as
        | { error?: { message?: string }; incomplete_details?: { reason?: string } }
        | undefined;
      const msg =
        resp?.error?.message ||
        resp?.incomplete_details?.reason ||
        `Codex returned ${type}`;
      throw new Error(msg);
    }

    default:
      return;
  }
}
