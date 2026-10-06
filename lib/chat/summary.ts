import type { SupabaseClient } from "@supabase/supabase-js";
import { modelsFor, type ProviderId } from "@/config/models";
import { reserve, settle } from "@/lib/billing/budget";
import { ADAPTERS } from "@/lib/providers";
import type { Usage } from "@/lib/providers/types";
import { costMicros, reservationMicros, estimateTokens } from "./context";

// Long chats: messages that no longer fit are folded into a running summary (written by the app's cheapest
// model, charged to the student like any other call), so the model still knows what happened earlier.
export const SUMMARY_TOKENS = 1_500; // room kept for the summary in each request
const MAX_SUMMARY_INPUT_CHARS = 48_000;

export async function updateSummary(o: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  provider: ProviderId;
  apiKey: string;
  existing: string | null;
  existingUpto: number | null;
  dropped: { seq: number; role: string; content: string }[]; // messages no longer sent, oldest first
}): Promise<string | null> {
  const fresh = o.dropped.filter((m) => m.seq > (o.existingUpto ?? 0));
  if (!fresh.length) return o.existing;

  const model = [...modelsFor(o.provider)].sort((a, b) => a.outputPrice - b.outputPrice)[0];
  let transcript = fresh.map((m) => `${m.role === "user" ? "Student" : "Assistant"}: ${m.content}`).join("\n\n");
  if (transcript.length > MAX_SUMMARY_INPUT_CHARS) transcript = transcript.slice(-MAX_SUMMARY_INPUT_CHARS);
  const prompt =
    (o.existing ? `Current summary:\n${o.existing}\n\n` : "") +
    `New earlier messages to fold in:\n${transcript}\n\n` +
    "Write an updated structured summary (max 250 words) with headings: Goal, Key facts & decisions, Work done so far, Open questions. " +
    "Keep course names, numbers, formulas and anything the student asked to remember. Output only the summary.";
  const system = "You summarize study conversations so another assistant can continue them.";
  const maxOutput = 700;
  const requestId = crypto.randomUUID();
  const r = await reserve(o.userId, requestId, model.id, "text", reservationMicros(model, estimateTokens(prompt + system), maxOutput));
  if (!r.ok) return o.existing; // no budget for a summary: carry on without updating it

  let text = "";
  let usage: Usage | undefined;
  try {
    for await (const ev of ADAPTERS[o.provider].stream({
      model, system, maxOutput, apiKey: o.apiKey, signal: AbortSignal.timeout(60_000),
      history: [{ role: "user", content: prompt }],
    })) {
      if (ev.delta) text += ev.delta;
      if (ev.usage) usage = ev.usage;
    }
  } catch {
    await settle(requestId, text ? "uncertain" : "released", 0, undefined, "summary_failed");
    return o.existing;
  }
  if (usage) await settle(requestId, "settled", costMicros(model, usage), usage);
  else await settle(requestId, "uncertain", 0, undefined, "no_usage");
  if (!text.trim()) return o.existing;

  const upto = fresh[fresh.length - 1].seq;
  await o.supabase.from("conversations").update({ summary: text.trim(), summary_upto: upto }).eq("id", o.conversationId);
  return text.trim();
}
