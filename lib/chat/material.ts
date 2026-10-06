import type { SupabaseClient } from "@supabase/supabase-js";
import { referenceLabel } from "@/lib/files/extract";
import type { TurnImage } from "@/lib/providers/types";
import { estimateTokens } from "./context";

// Course material for one question: passages from the chat's attachments and its course's files,
// each numbered [S1], [S2]… so the answer can point at exactly what was sent.

export type Source = { n: number; fileId: string; fileName: string; page: number | null; label: string; excerpt: string };
type FileRow = { id: string; name: string; kind: string; status: string; char_count: number | null; page_count: number | null; project_id: string | null; conversation_id: string | null; storage_path: string; mime: string };
type ChunkRow = { file_id: string; page: number | null; chunk_index: number; content: string };

export const MATERIAL_TOKEN_BUDGET = 12_000;
const SMALL_FILE_CHARS = 24_000; // attachments this small are sent whole
export const IMAGE_TOKENS = 1_600; // rough cost of one image in the prompt
export const MAX_IMAGES = 4;

export interface Material {
  sources: Source[];
  block: string;         // text added to the system prompt
  unreadable: string[];  // names of scanned/failed files, so the model can say it couldn't read them
  tokens: number;
  hasFiles: boolean;
}

export async function gatherMaterial(
  supabase: SupabaseClient,
  opts: { conversationId: string; projectId: string | null; question: string; newAttachmentIds: string[] },
): Promise<Material> {
  let q = supabase
    .from("files")
    .select("id, name, kind, status, char_count, page_count, project_id, conversation_id, storage_path, mime")
    .eq("kind", "document");
  q = opts.projectId ? q.or(`conversation_id.eq.${opts.conversationId},project_id.eq.${opts.projectId}`) : q.eq("conversation_id", opts.conversationId);
  const { data } = await q;
  const files = (data ?? []) as FileRow[];
  const ready = files.filter((f) => f.status === "ready");
  const unreadable = files.filter((f) => f.status !== "ready").map((f) => f.name);
  if (!ready.length) return { sources: [], block: "", unreadable, tokens: 0, hasFiles: files.length > 0 };

  const byId = new Map(ready.map((f) => [f.id, f]));
  const picked: ChunkRow[] = [];
  const seen = new Set<string>();
  let tokens = 0;
  const take = (c: ChunkRow) => {
    const key = `${c.file_id}:${c.chunk_index}`;
    if (seen.has(key)) return true;
    const t = estimateTokens(c.content);
    if (tokens + t > MATERIAL_TOKEN_BUDGET) return false;
    seen.add(key);
    picked.push(c);
    tokens += t;
    return true;
  };

  // 1. Small chat attachments are sent whole (newest first) — "summarize this" has no keywords to search for.
  const small = ready
    .filter((f) => f.conversation_id === opts.conversationId && (f.char_count ?? 0) <= SMALL_FILE_CHARS)
    .sort((a, b) => Number(opts.newAttachmentIds.includes(b.id)) - Number(opts.newAttachmentIds.includes(a.id)));
  for (const f of small) {
    const { data: chunks } = await supabase.from("file_chunks").select("file_id, page, chunk_index, content").eq("file_id", f.id).order("chunk_index");
    for (const c of (chunks ?? []) as ChunkRow[]) if (!take(c)) break;
  }

  // 2. Keyword search across the rest (course files and big attachments).
  const searchIds = ready.filter((f) => !small.includes(f)).map((f) => f.id);
  if (searchIds.length && opts.question.trim()) {
    const { data: hits } = await supabase.rpc("search_chunks", { p_query: opts.question, p_file_ids: searchIds, p_limit: 10 });
    for (const c of (hits ?? []) as ChunkRow[]) if (!take(c)) break;
  }

  // 3. A big file attached just now with no keyword hits: send its opening passages so the model sees it.
  for (const id of opts.newAttachmentIds) {
    if (!byId.has(id) || picked.some((c) => c.file_id === id)) continue;
    const { data: chunks } = await supabase.from("file_chunks").select("file_id, page, chunk_index, content").eq("file_id", id).order("chunk_index").limit(6);
    for (const c of (chunks ?? []) as ChunkRow[]) if (!take(c)) break;
  }

  // Keep document order within each file so passages read naturally.
  picked.sort((a, b) => (a.file_id === b.file_id ? a.chunk_index - b.chunk_index : 0));
  const sources: Source[] = picked.map((c, i) => {
    const f = byId.get(c.file_id)!;
    return { n: i + 1, fileId: c.file_id, fileName: f.name, page: c.page, label: referenceLabel(f.name, c.page, c.chunk_index), excerpt: c.content.slice(0, 280) };
  });
  const block = picked.map((c, i) => `[S${i + 1}] ${sources[i].label}\n${c.content}`).join("\n\n");
  return { sources, block, unreadable, tokens, hasFiles: true };
}

/** Images attached to the most recent user messages (newest MAX_IMAGES), as base64 for vision models. */
export async function loadImages(supabase: SupabaseClient, attachmentIdsByMessage: { messageIndex: number; ids: string[] }[]) {
  const wanted = attachmentIdsByMessage.flatMap((m) => m.ids.map((id) => ({ messageIndex: m.messageIndex, id }))).reverse();
  if (!wanted.length) return new Map<number, TurnImage[]>();
  const { data } = await supabase.from("files").select("id, storage_path, mime, kind").in("id", wanted.map((w) => w.id)).eq("kind", "image");
  const rows = new Map(((data ?? []) as Pick<FileRow, "id" | "storage_path" | "mime">[]).map((r) => [r.id, r]));
  const out = new Map<number, TurnImage[]>();
  let count = 0;
  for (const w of wanted) {
    const row = rows.get(w.id);
    if (!row || count >= MAX_IMAGES) continue;
    const { data: blob } = await supabase.storage.from("uploads").download(row.storage_path);
    if (!blob) continue;
    const img = { mime: row.mime, data: Buffer.from(await blob.arrayBuffer()).toString("base64") };
    out.set(w.messageIndex, [img, ...(out.get(w.messageIndex) ?? [])]);
    count++;
  }
  return out;
}

/** Which [S#] markers the answer actually cites — only those are shown as references. */
export function citedSources(answer: string, sources: Source[]): Source[] {
  const cited = new Set([...answer.matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1])));
  return sources.filter((s) => cited.has(s.n));
}
