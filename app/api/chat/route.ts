import { randomUUID } from "node:crypto";
import { getModel, isProvider } from "@/config/models";
import { isUuid, json, requireAppUser } from "@/lib/api";
import { isProviderDisabled, overRateLimit, reserve, settle } from "@/lib/billing/budget";
import { buildContext, costMicros, estimateTokens, maxOutputFor, reservationMicros, systemPrompt } from "@/lib/chat/context";
import { ADAPTERS, apiKeyFor, isLive } from "@/lib/providers";
import { ProviderError, type ChatTurn, type StreamEvent, type Usage } from "@/lib/providers/types";

// POST /api/chat — auth → ownership → gates → context → reserve → stream → reconcile → save.
// Body: { provider, modelId, content, conversationId?, projectId?, retry? }
// Response: newline-delimited JSON events: meta, delta…, then done or error.
export const maxDuration = 300;

type Body = { provider?: unknown; modelId?: unknown; content?: unknown; conversationId?: unknown; projectId?: unknown; retry?: unknown };

const MAX_MESSAGE_CHARS = 32_000;

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || !isProvider(body.provider)) return json({ error: "bad_request" }, 400);
  const provider = body.provider;
  const model = getModel(typeof body.modelId === "string" ? body.modelId : undefined);
  if (!model || !model.enabled || model.provider !== provider) return json({ error: "unknown_model" }, 400);
  const retry = body.retry === true;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!retry && !content) return json({ error: "empty_message" }, 400);
  if (content.length > MAX_MESSAGE_CHARS) return json({ error: "message_too_long" }, 400);

  // ---- conversation (RLS: only the user's own rows are visible or writable)
  let conversation: { id: string; title: string; provider: string; project_id: string | null };
  if (isUuid(body.conversationId)) {
    const { data } = await supabase.from("conversations").select("id, title, provider, project_id").eq("id", body.conversationId).maybeSingle();
    if (!data) return json({ error: "not_found" }, 404);
    if (data.provider !== provider) return json({ error: "wrong_app" }, 400);
    conversation = data;
  } else {
    if (retry) return json({ error: "bad_request" }, 400);
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, provider, model_id: model.id, title: content.slice(0, 60), project_id: isUuid(body.projectId) ? body.projectId : null })
      .select("id, title, provider, project_id")
      .single();
    if (error || !data) return json({ error: "save_failed" }, 500);
    conversation = data;
  }

  // ---- the user's message (or, on retry, drop the failed reply and reuse the last question)
  let userMessageId: string;
  if (retry) {
    const { data: msgs } = await supabase.from("messages").select("id, role, seq").eq("conversation_id", conversation.id).eq("kind", "text").order("seq");
    const lastUser = [...(msgs ?? [])].reverse().find((m) => m.role === "user");
    if (!lastUser) return json({ error: "nothing_to_retry" }, 400);
    await supabase.from("messages").delete().eq("conversation_id", conversation.id).eq("role", "assistant").gt("seq", lastUser.seq);
    userMessageId = lastUser.id;
  } else {
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversation.id, user_id: user.id, role: "user", content })
      .select("id")
      .single();
    if (error || !data) return json({ error: "save_failed" }, 500);
    userMessageId = data.id;
  }
  await supabase.from("conversations").update({ model_id: model.id, updated_at: new Date().toISOString() }).eq("id", conversation.id);

  // ---- history + project instructions → context
  const { data: rows } = await supabase
    .from("messages")
    .select("role, content, status, kind")
    .eq("conversation_id", conversation.id)
    .order("seq");
  const history: ChatTurn[] = (rows ?? [])
    .filter((m) => m.kind === "text" && m.status !== "error" && m.content)
    .map((m) => ({ role: m.role as ChatTurn["role"], content: m.content as string }));

  let project: { name: string; instructions: string } | null = null;
  if (conversation.project_id) {
    const { data } = await supabase.from("projects").select("name, instructions").eq("id", conversation.project_id).maybeSingle();
    project = data;
  }
  const system = systemPrompt(model.label, project?.name, project?.instructions);
  const ctx = buildContext(history, model.contextTokens - estimateTokens(system));
  const inputTokens = ctx.tokens + estimateTokens(system);

  // ---- gates + reservation (live mode only)
  const live = isLive();
  const requestId = randomUUID();
  let maxOutput = model.maxOutputTokens;
  let apiKey: string | null = null;
  if (live) {
    apiKey = apiKeyFor(provider);
    if (!apiKey) return json({ error: "not_configured", conversationId: conversation.id }, 503);
    if (await isProviderDisabled(provider)) return json({ error: "provider_disabled", conversationId: conversation.id }, 503);
    if (await overRateLimit(user.id)) return json({ error: "rate_limited", conversationId: conversation.id }, 429);

    let r = await reserve(user.id, requestId, model.id, "text", reservationMicros(model, inputTokens, maxOutput));
    if (!r.ok && r.reason === "budget" && r.remaining) {
      // Shrink the reply to fit what's left, if that still allows a useful answer.
      const fit = Math.min(maxOutput, maxOutputFor(model, inputTokens, r.remaining));
      if (fit >= 500) {
        maxOutput = fit;
        r = await reserve(user.id, requestId, model.id, "text", reservationMicros(model, inputTokens, maxOutput));
      }
    }
    if (!r.ok) {
      const code = r.reason === "global_stop" ? "paused" : r.reason === "budget" ? "budget" : "reserve_failed";
      return json({ error: code, conversationId: conversation.id }, code === "budget" ? 402 : 503);
    }
  }

  // ---- placeholder reply row, then stream
  const { data: replyRow } = await supabase
    .from("messages")
    .insert({ conversation_id: conversation.id, user_id: user.id, role: "assistant", content: "", model_id: model.id, status: "partial" })
    .select("id")
    .single();
  const replyId = replyRow?.id ?? randomUUID();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let clientGone = false;
      const send = (ev: object) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          clientGone = true;
        }
      };
      request.signal.addEventListener("abort", () => (clientGone = true));

      send({ t: "meta", conversationId: conversation.id, title: conversation.title, userMessageId, replyId, modelId: model.id, dropped: ctx.dropped });

      let text = "";
      let shown = ""; // what the student actually saw (if they pressed Stop)
      let usage: Usage | undefined;
      let failure: ProviderError | null = null;
      try {
        const events = live
          ? ADAPTERS[provider].stream({ model, system, history: ctx.turns, maxOutput, apiKey: apiKey!, signal: AbortSignal.timeout(240_000) })
          : mockStream(model.label, history, ctx.dropped);
        for await (const ev of events) {
          if (ev.delta) {
            text += ev.delta;
            if (!clientGone) shown = text;
            send({ t: "delta", v: ev.delta });
          }
          if (ev.usage) usage = ev.usage;
          // If the student stopped, keep reading (server-side) so the provider reports real usage and we charge
          // the actual cost instead of the full reservation.
        }
      } catch (e) {
        failure = e instanceof ProviderError ? e : new ProviderError((e as Error)?.name === "TimeoutError" ? "timeout" : "unknown", undefined, text.length > 0);
      }

      const stopped = clientGone && !failure;
      const finalText = stopped ? shown : text;
      const status = failure ? "error" : stopped ? "partial" : "complete";
      await supabase.from("messages").update({ content: finalText, status }).eq("id", replyId);
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversation.id);

      if (live) {
        if (usage) await settle(requestId, "settled", costMicros(model, usage), usage, failure?.code);
        else if (failure && !failure.started && text.length === 0) await settle(requestId, "released", 0, undefined, failure.code);
        else await settle(requestId, "uncertain", 0, undefined, failure?.code ?? "no_usage");
      }

      if (failure) send({ t: "error", code: failure.code });
      else send({ t: "done", status });
      try {
        controller.close();
      } catch {}
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Demo mode (LIVE_MODELS not "on"): a fake streamed reply, no provider call, no cost.
async function* mockStream(label: string, history: ChatTurn[], dropped: boolean): AsyncGenerator<StreamEvent> {
  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const reply =
    `(${label} demo reply) You said: "${lastUser.slice(0, 200)}". ` +
    `This chat has ${history.length} message${history.length === 1 ? "" : "s"} of history` +
    (dropped ? ", but older ones didn't fit and weren't sent." : ".") +
    " Real answers appear once LIVE_MODELS=on and the API keys are set.";
  for (const w of reply.split(/(\s+)/)) {
    await new Promise((r) => setTimeout(r, 20));
    yield { delta: w };
  }
}
