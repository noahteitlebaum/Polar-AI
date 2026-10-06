import { randomUUID } from "node:crypto";
import { getModel, isProvider } from "@/config/models";
import { isUuid, json, requireAppUser } from "@/lib/api";
import { isProviderDisabled, overRateLimit, reserve, settle } from "@/lib/billing/budget";
import { buildContext, costMicros, estimateTokens, maxOutputFor, reservationMicros, STUDY_MODES, systemPrompt, type StudyMode } from "@/lib/chat/context";
import { citedSources, gatherMaterial, IMAGE_TOKENS, loadImages, MAX_IMAGES, type Source } from "@/lib/chat/material";
import { SUMMARY_TOKENS, updateSummary } from "@/lib/chat/summary";
import { ADAPTERS, apiKeyFor, isLive } from "@/lib/providers";
import { ProviderError, type ChatTurn, type StreamEvent, type Usage } from "@/lib/providers/types";

// POST /api/chat — auth → ownership → gates → context (+ course material, images, summary) → reserve → stream → reconcile → save.
// Body: { provider, modelId, content, conversationId?, projectId?, retry?, attachmentIds?, mode?, courseOnly? }
// Response: newline-delimited JSON events: meta, delta…, then done (with cited sources) or error.
export const maxDuration = 300;

type Body = {
  provider?: unknown; modelId?: unknown; content?: unknown; conversationId?: unknown; projectId?: unknown; retry?: unknown;
  attachmentIds?: unknown; mode?: unknown; courseOnly?: unknown;
};
type Row = { id: string; seq: number; role: "user" | "assistant"; content: string; status: string; kind: string; attachment_ids: string[] | null };

const MAX_MESSAGE_CHARS = 32_000;
const MAX_ATTACHMENTS = 10;

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
  const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.filter(isUuid).slice(0, MAX_ATTACHMENTS) : [];
  if (!retry && !content && !attachmentIds.length) return json({ error: "empty_message" }, 400);
  if (content.length > MAX_MESSAGE_CHARS) return json({ error: "message_too_long" }, 400);

  // ---- conversation (RLS: only the user's own rows are visible or writable)
  let conversation: { id: string; title: string; provider: string; project_id: string | null; mode: string; course_only: boolean; summary: string | null; summary_upto: number | null };
  const convCols = "id, title, provider, project_id, mode, course_only, summary, summary_upto";
  if (isUuid(body.conversationId)) {
    const { data } = await supabase.from("conversations").select(convCols).eq("id", body.conversationId).maybeSingle();
    if (!data) return json({ error: "not_found" }, 404);
    if (data.provider !== provider) return json({ error: "wrong_app" }, 400);
    conversation = data;
  } else {
    if (retry) return json({ error: "bad_request" }, 400);
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, provider, model_id: model.id, title: (content || "Files").slice(0, 60), project_id: isUuid(body.projectId) ? body.projectId : null })
      .select(convCols)
      .single();
    if (error || !data) return json({ error: "save_failed" }, 500);
    conversation = data;
  }

  // Study mode and "only use my course material" stick to the chat once set.
  const settings: Record<string, unknown> = { model_id: model.id, updated_at: new Date().toISOString() };
  if (typeof body.mode === "string" && (STUDY_MODES as string[]).includes(body.mode)) settings.mode = conversation.mode = body.mode;
  if (typeof body.courseOnly === "boolean") settings.course_only = conversation.course_only = body.courseOnly;
  await supabase.from("conversations").update(settings).eq("id", conversation.id);

  // ---- attachments: only the student's own, not-yet-used uploads; they now belong to this chat
  let linked: string[] = [];
  if (attachmentIds.length && !retry) {
    const { data } = await supabase.from("files").select("id").in("id", attachmentIds).is("project_id", null).is("conversation_id", null);
    linked = (data ?? []).map((f) => f.id as string);
    if (linked.length) await supabase.from("files").update({ conversation_id: conversation.id }).in("id", linked);
  }

  // ---- the student's message (or, on retry, drop the failed reply and reuse the last question)
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
      .insert({ conversation_id: conversation.id, user_id: user.id, role: "user", content, attachment_ids: linked })
      .select("id")
      .single();
    if (error || !data) return json({ error: "save_failed" }, 500);
    userMessageId = data.id;
  }

  // ---- history
  const { data: rawRows } = await supabase
    .from("messages")
    .select("id, seq, role, content, status, kind, attachment_ids")
    .eq("conversation_id", conversation.id)
    .order("seq");
  const rows = ((rawRows ?? []) as Row[]).filter((m) => m.kind === "text" && m.status !== "error" && (m.content || m.attachment_ids?.length));
  const history: ChatTurn[] = rows.map((m) => ({ role: m.role, content: m.content }));
  const question = [...rows].reverse().find((m) => m.role === "user")?.content ?? content;

  // ---- course + material from files
  let project: { name: string; instructions: string } | null = null;
  if (conversation.project_id) {
    const { data } = await supabase.from("projects").select("name, instructions").eq("id", conversation.project_id).maybeSingle();
    project = data;
  }
  const material = await gatherMaterial(supabase, {
    conversationId: conversation.id, projectId: conversation.project_id, question,
    newAttachmentIds: retry ? rows.at(-1)?.attachment_ids ?? [] : linked,
  });
  const imageCount = Math.min(MAX_IMAGES, rows.reduce((n, r) => n + (r.attachment_ids?.length ?? 0), 0));

  const live = isLive();
  const requestId = randomUUID();
  let apiKey: string | null = null;
  if (live) {
    apiKey = apiKeyFor(provider);
    if (!apiKey) return json({ error: "not_configured", conversationId: conversation.id }, 503);
    if (await isProviderDisabled(provider)) return json({ error: "provider_disabled", conversationId: conversation.id }, 503);
    if (await overRateLimit(user.id)) return json({ error: "rate_limited", conversationId: conversation.id }, 429);
  }

  const promptBase = {
    modelLabel: model.label, projectName: project?.name, projectInstructions: project?.instructions,
    mode: conversation.mode as StudyMode, material: material.block, courseOnly: conversation.course_only,
    hasFiles: material.hasFiles, unreadable: material.unreadable,
  };
  const baseTokens = estimateTokens(systemPrompt(promptBase)) + imageCount * IMAGE_TOKENS;
  const ctx = buildContext(history, model.contextTokens - baseTokens - SUMMARY_TOKENS);

  // ---- long chat: fold messages that no longer fit into a running summary (live only; charged like any call)
  let summary = conversation.summary;
  if (ctx.dropped) {
    const droppedRows = rows.slice(0, rows.length - ctx.turns.length);
    if (live && apiKey) {
      summary = await updateSummary({
        supabase, userId: user.id, conversationId: conversation.id, provider, apiKey,
        existing: conversation.summary, existingUpto: conversation.summary_upto, dropped: droppedRows,
      });
    }
  }

  // ---- images on the kept turns go to the vision model
  const keptRows = rows.slice(rows.length - ctx.turns.length);
  const images = await loadImages(supabase, keptRows.map((r, i) => ({ messageIndex: i, ids: r.attachment_ids ?? [] })).filter((m) => m.ids.length));
  const turns: ChatTurn[] = ctx.turns.map((t, i) => (images.has(i) ? { ...t, images: images.get(i) } : t));

  const system = systemPrompt({ ...promptBase, summary });
  const inputTokens = ctx.tokens + estimateTokens(system) + [...images.values()].flat().length * IMAGE_TOKENS;

  // ---- reservation (live only)
  let maxOutput = model.maxOutputTokens;
  if (live) {
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

      send({
        t: "meta", conversationId: conversation.id, title: conversation.title, userMessageId, replyId, modelId: model.id,
        dropped: ctx.dropped, summarized: Boolean(ctx.dropped && summary), mode: conversation.mode, courseOnly: conversation.course_only,
        attachmentIds: linked,
      });

      let text = "";
      let shown = ""; // what the student actually saw (if they pressed Stop)
      let usage: Usage | undefined;
      let failure: ProviderError | null = null;
      try {
        const events = live
          ? ADAPTERS[provider].stream({ model, system, history: turns, maxOutput, apiKey: apiKey!, signal: AbortSignal.timeout(240_000) })
          : mockStream(model.label, history, ctx.dropped, material.sources, conversation.mode);
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
      const sources = citedSources(finalText, material.sources);
      await supabase.from("messages").update({ content: finalText, status, sources: sources.length ? sources : null }).eq("id", replyId);
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversation.id);

      if (live) {
        if (usage) await settle(requestId, "settled", costMicros(model, usage), usage, failure?.code);
        else if (failure && !failure.started && text.length === 0) await settle(requestId, "released", 0, undefined, failure.code);
        else await settle(requestId, "uncertain", 0, undefined, failure?.code ?? "no_usage");
      }

      if (failure) send({ t: "error", code: failure.code });
      else send({ t: "done", status, sources });
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
async function* mockStream(label: string, history: ChatTurn[], dropped: boolean, sources: Source[], mode: string): AsyncGenerator<StreamEvent> {
  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const reply =
    `(${label} demo reply${mode !== "chat" ? `, ${mode} mode` : ""}) You said: "${lastUser.slice(0, 200)}". ` +
    `This chat has ${history.length} message${history.length === 1 ? "" : "s"} of history` +
    (dropped ? ", but older ones didn't fit and weren't sent." : ".") +
    (sources.length ? ` I found ${sources.length} matching passage${sources.length === 1 ? "" : "s"} in your files, e.g. ${sources[0].label} [S1].` : "") +
    " Real answers appear once LIVE_MODELS=on and the API keys are set.";
  for (const w of reply.split(/(\s+)/)) {
    await new Promise((r) => setTimeout(r, 15));
    yield { delta: w };
  }
}
