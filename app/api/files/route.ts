import { dbError, isUuid, json, requireAppUser } from "@/lib/api";
import { DOC_TYPES, IMAGE_TYPES, MAX_DOC_BYTES, MAX_IMAGE_BYTES, detectMime, extractDocument } from "@/lib/files/extract";

// Uploads go browser → Supabase Storage directly (uploads/<user>/<fileId>/<name>), then the browser calls:
//   POST /api/files { id, path, name, projectId? }  → we check, extract text with page numbers, and index it.
//   GET  /api/files?projectId=…                      → a course's files
export const maxDuration = 120;

export type FileSummary = {
  id: string; name: string; kind: "document" | "image"; status: "ready" | "failed" | "needs_ocr";
  pageCount: number | null; error: string | null; mime: string;
};

const toSummary = (f: Record<string, unknown>): FileSummary => ({
  id: f.id as string, name: f.name as string, kind: f.kind as FileSummary["kind"], status: f.status as FileSummary["status"],
  pageCount: (f.page_count as number | null) ?? null, error: (f.error as string | null) ?? null, mime: f.mime as string,
});

export async function GET(request: Request) {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return json({ error: "bad_request" }, 400);
  const { data, error } = await auth.supabase
    .from("files")
    .select("id, name, kind, status, page_count, error, mime")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) return dbError(error, "load_failed");
  return json({ files: (data ?? []).map(toSummary) });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;
  const body = (await request.json().catch(() => null)) as { id?: unknown; path?: unknown; name?: unknown; projectId?: unknown } | null;
  if (!body || !isUuid(body.id) || typeof body.path !== "string" || typeof body.name !== "string") return json({ error: "bad_request" }, 400);
  const id = body.id;
  const path = body.path;
  const name = body.name.slice(0, 200);
  // The object must be in this student's own folder for this file id.
  if (!path.startsWith(`${user.id}/${id}/`) || path.includes("..")) return json({ error: "bad_request" }, 400);

  const { data: blob, error: dlErr } = await supabase.storage.from("uploads").download(path);
  if (dlErr || !blob) return json({ error: "upload_missing" }, 400);
  const mime = detectMime(name, blob.type);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const isImage = IMAGE_TYPES.has(mime);
  const isDoc = Boolean(DOC_TYPES[mime]);

  const reject = async (code: string) => {
    await supabase.storage.from("uploads").remove([path]);
    return json({ error: code }, 400);
  };
  if (!isImage && !isDoc) return reject("unsupported_type");
  if (bytes.length > (isImage ? MAX_IMAGE_BYTES : MAX_DOC_BYTES)) return reject("too_large");

  let status: FileSummary["status"] = "ready";
  let pageCount: number | null = null;
  let charCount: number | null = null;
  let errorText: string | null = null;
  let chunks: { page: number | null; chunkIndex: number; content: string }[] = [];
  if (isDoc) {
    try {
      const r = await extractDocument(bytes, mime);
      status = r.status;
      pageCount = r.pageCount;
      charCount = r.charCount;
      chunks = r.chunks;
      if (status === "needs_ocr") errorText = "This looks like a scanned PDF, so its text can't be read yet. Try a text-based PDF or upload page screenshots.";
    } catch (e) {
      status = "failed";
      errorText = (e as Error).message === "too_many_pages" ? "That document has too many pages (max 400)." : "We couldn't read this file.";
    }
  }

  const { data: row, error } = await supabase
    .from("files")
    .insert({
      id, user_id: user.id, name, mime, size_bytes: bytes.length, storage_path: path,
      kind: isImage ? "image" : "document", status, page_count: pageCount, char_count: charCount, error: errorText,
      project_id: isUuid(body.projectId) ? body.projectId : null,
    })
    .select("id, name, kind, status, page_count, error, mime")
    .single();
  if (error || !row) {
    await supabase.storage.from("uploads").remove([path]);
    return dbError(error, "save_failed", 400);
  }

  for (let i = 0; i < chunks.length; i += 500) {
    const batch = chunks.slice(i, i + 500).map((c) => ({ file_id: id, user_id: user.id, page: c.page, chunk_index: c.chunkIndex, content: c.content }));
    const { error: cErr } = await supabase.from("file_chunks").insert(batch);
    if (cErr) {
      await supabase.from("files").update({ status: "failed", error: "We couldn't index this file." }).eq("id", id);
      return json({ file: { ...toSummary(row), status: "failed", error: "We couldn't index this file." } });
    }
  }
  return json({ file: toSummary(row) });
}
