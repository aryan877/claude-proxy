import { describe, it, expect } from "vitest";
import {
  toResponsesTools,
  toResponsesToolChoice,
  toResponsesInput,
} from "../adapters/providers/codex-oauth.js";
import { parseProviderModel } from "../adapters/map.js";
import { conversationKey, threadIdFor } from "../adapters/codex-reasoning-cache.js";
import type { AnthropicMessage, AnthropicTool } from "../adapters/types.js";

describe("toResponsesTools", () => {
  it("converts Anthropic tools to Responses API function tools and appends web_search", () => {
    const tools: AnthropicTool[] = [
      {
        name: "Bash",
        description: "Run a shell command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    ];
    const out = toResponsesTools(tools);
    expect(out).toEqual([
      {
        type: "function",
        name: "Bash",
        description: "Run a shell command",
        strict: false,
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
      { type: "web_search" },
    ]);
  });

  it("provides a default empty parameters object when input_schema is missing", () => {
    const out = toResponsesTools([{ name: "NoSchema" }]);
    expect(out[0]).toMatchObject({
      type: "function",
      name: "NoSchema",
      parameters: { type: "object", properties: {} },
    });
  });

  it("returns just web_search when no tools provided", () => {
    expect(toResponsesTools(undefined)).toEqual([{ type: "web_search" }]);
  });
});

describe("toResponsesToolChoice", () => {
  it("maps Anthropic tool_choice to Responses API tool_choice", () => {
    expect(toResponsesToolChoice(undefined)).toBe("auto");
    expect(toResponsesToolChoice({ type: "auto" })).toBe("auto");
    expect(toResponsesToolChoice({ type: "any" })).toBe("required");
    expect(toResponsesToolChoice({ type: "none" })).toBe("none");
    expect(toResponsesToolChoice({ type: "tool", name: "Bash" })).toEqual({
      type: "function",
      name: "Bash",
    });
  });
});

describe("toResponsesInput", () => {
  it("converts a plain user message into an input_text message item", () => {
    const messages: AnthropicMessage[] = [{ role: "user", content: "hello" }];
    expect(toResponsesInput(messages)).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    ]);
  });

  it("converts assistant text to output_text", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello back" },
    ];
    const out = toResponsesInput(messages);
    expect(out[1]).toEqual({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "hello back" }],
    });
  });

  it("emits tool_use as a top-level function_call item with the same call_id", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me run that." },
          {
            type: "tool_use",
            id: "toolu_abc123",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
      },
    ];
    const out = toResponsesInput(messages);
    expect(out).toEqual([
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Let me run that." }],
      },
      {
        type: "function_call",
        call_id: "toolu_abc123",
        name: "Bash",
        arguments: '{"command":"ls"}',
      },
    ]);
  });

  it("emits tool_result as a top-level function_call_output keyed by tool_use_id", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_abc123",
            content: "total 24\ndrwxr-xr-x ...",
          },
        ],
      },
    ];
    const out = toResponsesInput(messages);
    expect(out).toEqual([
      {
        type: "function_call_output",
        call_id: "toolu_abc123",
        output: "total 24\ndrwxr-xr-x ...",
      },
    ]);
  });

  it("encodes a base64 image as input_image with a data URL", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What's in this?" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "AAAA" },
          },
        ],
      },
    ];
    const out = toResponsesInput(messages);
    expect(out[0]).toEqual({
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "What's in this?" },
        { type: "input_image", image_url: "data:image/png;base64,AAAA" },
      ],
    });
  });

  it("passes through a URL image as input_image with the original URL", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "url", url: "https://example.com/x.png", media_type: "image/png" },
          },
        ],
      },
    ];
    const out = toResponsesInput(messages);
    expect(out[0]).toMatchObject({
      content: [{ type: "input_image", image_url: "https://example.com/x.png" }],
    });
  });

  it("converts thinking blocks to reasoning items", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me consider...", signature: "sig" },
          { type: "text", text: "answer" },
        ],
      },
    ];
    const out = toResponsesInput(messages);
    expect(out).toEqual([
      {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "Let me consider..." }],
        encrypted_content: null,
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "answer" }],
      },
    ]);
  });

  it("prepends injected reasoning items from the cache", () => {
    const injected = [
      {
        type: "reasoning" as const,
        summary: [{ type: "summary_text" as const, text: "prev" }],
        encrypted_content: "enc_blob",
      },
    ];
    const messages: AnthropicMessage[] = [{ role: "user", content: "next turn" }];
    const out = toResponsesInput(messages, injected);
    expect(out[0]).toEqual(injected[0]);
    expect(out[1]).toEqual({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "next turn" }],
    });
  });

  it("flattens structured tool_result content into a string", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_x",
            content: [
              { type: "text", text: "line 1" },
              { type: "text", text: "line 2" },
            ],
          },
        ],
      },
    ];
    const out = toResponsesInput(messages);
    expect(out[0]).toEqual({
      type: "function_call_output",
      call_id: "toolu_x",
      output: "line 1\nline 2",
    });
  });
});

describe("parseProviderModel — codex tier shortcuts", () => {
  it("expands codex to gpt-5.5 with no implicit reasoning", () => {
    expect(parseProviderModel("codex")).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
      reasoning: undefined,
    });
  });

  it("expands tier shortcuts to gpt-5.5 plus a baked-in reasoning level", () => {
    expect(parseProviderModel("fast")).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
      reasoning: "low",
    });
    expect(parseProviderModel("smart")).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
      reasoning: "medium",
    });
    expect(parseProviderModel("deep")).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
      reasoning: "high",
    });
    expect(parseProviderModel("max")).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
      reasoning: "xhigh",
    });
    expect(parseProviderModel("think")).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
      reasoning: "xhigh",
    });
  });

  it("lets an explicit @level override the level baked into a shortcut", () => {
    expect(parseProviderModel("fast@xhigh")).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
      reasoning: "xhigh",
    });
  });

  it("supports verbatim codex@level syntax", () => {
    expect(parseProviderModel("codex@xhigh")).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
      reasoning: "xhigh",
    });
    expect(parseProviderModel("codex@low")).toEqual({
      provider: "codex-oauth",
      model: "gpt-5.5",
      reasoning: "low",
    });
  });
});

describe("conversationKey + threadIdFor", () => {
  it("returns the same key for the same first user turn", () => {
    const a = conversationKey([{ role: "user", content: "hello world" }]);
    const b = conversationKey([
      { role: "user", content: "hello world" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "different follow-up" },
    ]);
    expect(a).toBe(b);
  });

  it("returns different keys for different first user turns", () => {
    const a = conversationKey([{ role: "user", content: "alpha" }]);
    const b = conversationKey([{ role: "user", content: "beta" }]);
    expect(a).not.toBe(b);
  });

  it("produces a UUID-shaped thread ID from a key", () => {
    const k = conversationKey([{ role: "user", content: "x" }]);
    const t = threadIdFor(k);
    expect(t).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
