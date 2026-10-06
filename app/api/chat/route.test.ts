import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import type { StreamEvent } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";

// Route test with mocked auth, database, budget and providers (no live calls, no money).
const state = vi.hoisted(() => ({
  fake: null as ReturnType<typeof import("@/test/fake-supabase").fakeSupabase> | null,
  live: false,
  key: "k" as string | null,
  events: [] as unknown[],
  failBeforeStart: false,
  reserveOk: true,
}));

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  requireAppUser: async () => ({ user: { id: "user-1" }, supabase: state.fake!.client }),
}));
vi.mock("@/lib/billing/budget", () => ({
  reserve: vi.fn(async () => (state.reserveOk ? { ok: true, remaining: 1 } : { ok: false, reason: "budget", remaining: 0 })),
  settle: vi.fn(async () => {}),
  isProviderDisabled: vi.fn(async () => false),
  overRateLimit: vi.fn(async () => false),
}));
vi.mock("@/lib/providers", () => ({
  isLive: () => state.live,
  apiKeyFor: () => state.key,
  ADAPTERS: {
    anthropic: {
      id: "anthropic",
      async *stream(): AsyncGenerator<StreamEvent> {
        if (state.failBeforeStart) throw new ProviderError("unavailable", 503);
        for (const e of state.events as StreamEvent[]) yield e;
      },
    },
  },
}));

import { POST } from "./route";
import * as budget from "@/lib/billing/budget";

const req = (body: object) => new Request("http://x/api/chat", { method: "POST", body: JSON.stringify(body) });
async function readEvents(res: Response) {
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l));
}

beforeEach(() => {
  state.fake = fakeSupabase();
  state.live = false;
  state.key = "k";
  state.failBeforeStart = false;
  state.reserveOk = true;
  state.events = [{ delta: "Hi " }, { delta: "there" }, { usage: { input: 1000, output: 100, reasoning: 0, cached: 0 } }];
  vi.clearAllMocks();
});

describe("POST /api/chat", () => {
  it("rejects a model from another app", async () => {
    const res = await POST(req({ provider: "anthropic", modelId: "openai-default", content: "hi" }));
    expect(res.status).toBe(400);
  });

  it("demo mode: creates the chat, streams, saves both messages, never touches the budget", async () => {
    const res = await POST(req({ provider: "anthropic", modelId: "anthropic-default", content: "hello" }));
    const events = await readEvents(res);
    expect(events[0]).toMatchObject({ t: "meta", title: "hello" });
    expect(events.at(-1)).toEqual({ t: "done", status: "complete" });
    const { db } = state.fake!;
    expect(db.conversations).toHaveLength(1);
    expect(db.conversations[0]).toMatchObject({ provider: "anthropic", user_id: "user-1" });
    expect(db.messages.map((m) => [m.role, m.status])).toEqual([["user", "complete"], ["assistant", "complete"]]);
    expect(budget.reserve).not.toHaveBeenCalled();
  });

  it("live: reserves first, then settles at the actual cost", async () => {
    state.live = true;
    const res = await POST(req({ provider: "anthropic", modelId: "anthropic-default", content: "hello" }));
    await readEvents(res);
    expect(budget.reserve).toHaveBeenCalledOnce();
    // Sonnet 5.5: $2 in / $10 out per 1M → 1000×2 + 100×10 = 3000 micros
    expect(budget.settle).toHaveBeenCalledWith(expect.any(String), "settled", 3000, expect.anything(), undefined);
    expect(state.fake!.db.messages[1]).toMatchObject({ content: "Hi there", status: "complete", model_id: "anthropic-default" });
  });

  it("live: a provider that fails before replying is released (not charged) and the reply is marked error", async () => {
    state.live = true;
    state.failBeforeStart = true;
    const events = await readEvents(await POST(req({ provider: "anthropic", modelId: "anthropic-default", content: "hello" })));
    expect(events.at(-1)).toEqual({ t: "error", code: "unavailable" });
    expect(budget.settle).toHaveBeenCalledWith(expect.any(String), "released", 0, undefined, "unavailable");
    expect(state.fake!.db.messages[1].status).toBe("error");
  });

  it("live: no usage reported → charged the full reservation (uncertain)", async () => {
    state.live = true;
    state.events = [{ delta: "partial" }];
    await readEvents(await POST(req({ provider: "anthropic", modelId: "anthropic-default", content: "hello" })));
    expect(budget.settle).toHaveBeenCalledWith(expect.any(String), "uncertain", 0, undefined, "no_usage");
  });

  it("live: out of budget → 402, no provider call, chat id returned so the question isn't lost", async () => {
    state.live = true;
    state.reserveOk = false;
    const res = await POST(req({ provider: "anthropic", modelId: "anthropic-default", content: "hello" }));
    expect(res.status).toBe(402);
    expect((await res.json()).conversationId).toBe(state.fake!.db.conversations[0].id);
    expect(state.fake!.db.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  it("live: missing API key → 503 not_configured", async () => {
    state.live = true;
    state.key = null;
    const res = await POST(req({ provider: "anthropic", modelId: "anthropic-default", content: "hello" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
  });

  it("retry drops the failed reply and answers the same question once", async () => {
    const first = await readEvents(await POST(req({ provider: "anthropic", modelId: "anthropic-default", content: "q" })));
    const conversationId = first[0].conversationId;
    state.fake!.db.messages[1].status = "error";
    await readEvents(await POST(req({ provider: "anthropic", modelId: "anthropic-default", conversationId, retry: true })));
    const msgs = state.fake!.db.messages;
    expect(msgs.filter((m) => m.role === "user")).toHaveLength(1);
    expect(msgs.filter((m) => m.role === "assistant").map((m) => m.status)).toEqual(["complete"]);
  });

  it("won't continue a chat from another app", async () => {
    const first = await readEvents(await POST(req({ provider: "anthropic", modelId: "anthropic-default", content: "q" })));
    const res = await POST(req({ provider: "openai", modelId: "openai-default", content: "q2", conversationId: first[0].conversationId }));
    expect(res.status).toBe(400);
  });
});
