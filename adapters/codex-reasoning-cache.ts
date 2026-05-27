// Per-session cache of Codex Responses-API encrypted reasoning blobs.
//
// Codex returns Reasoning items with an opaque `encrypted_content` field. When you echo
// the same blob back on the next turn, the server unpacks it and gets the model's prior
// chain-of-thought "for free" — no extra latency, better quality on multi-step tasks.
//
// Claude Code is unaware of these blobs. We key the cache by a stable conversation hash
// derived from the user-turn texts so the same Claude conversation maps to the same cache
// slot across turns. Cache entries expire after 30 minutes of inactivity.

import { createHash } from "crypto";
import type { AnthropicMessage } from "./types.js";

type ReasoningItem = {
  type: "reasoning";
  summary: Array<{ type: "summary_text"; text: string }>;
  encrypted_content?: string | null;
};

type Entry = {
  items: ReasoningItem[];
  threadId: string;
  lastAccess: number;
};

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, Entry>();

function userTextOf(m: AnthropicMessage): string {
  if (m.role !== "user") return "";
  if (typeof m.content === "string") return m.content;
  return m.content
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "tool_result") {
        return typeof b.content === "string" ? b.content : JSON.stringify(b.content);
      }
      return "";
    })
    .join("\n");
}

/** Stable key from the conversation prefix. The first user turn determines the session. */
export function conversationKey(messages: AnthropicMessage[]): string {
  const firstUserIdx = messages.findIndex((m) => m.role === "user");
  if (firstUserIdx === -1) return "anon";
  const first = userTextOf(messages[firstUserIdx]).slice(0, 4096);
  return createHash("sha256").update(first).digest("hex").slice(0, 24);
}

/** Returns the conversation's prompt_cache_key (UUID-shaped from the hash). */
export function threadIdFor(key: string): string {
  if (!cache.has(key)) {
    cache.set(key, {
      items: [],
      threadId: `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20, 24).padEnd(12, "0")}`,
      lastAccess: Date.now(),
    });
  }
  return cache.get(key)!.threadId;
}

/** All cached reasoning items for this conversation, in arrival order. */
export function reasoningItems(key: string): ReasoningItem[] {
  reap();
  const e = cache.get(key);
  if (!e) return [];
  e.lastAccess = Date.now();
  return e.items;
}

/** Replace the cached reasoning items for this conversation with what the server just sent. */
export function setReasoningItems(key: string, items: ReasoningItem[]) {
  reap();
  const e = cache.get(key) ?? {
    items: [],
    threadId: threadIdFor(key),
    lastAccess: Date.now(),
  };
  e.items = items;
  e.lastAccess = Date.now();
  cache.set(key, e);
}

function reap() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of cache) if (v.lastAccess < cutoff) cache.delete(k);
}
