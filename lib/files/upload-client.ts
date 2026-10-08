"use client";

import { createBrowserSupabase } from "@/lib/supabase/browser";

// Browser side of an upload: check type/size, put the file in Storage (the student's own folder),
// then ask the server to read and index it.
export type UploadedFile = {
  id: string; name: string; kind: "document" | "image"; status: "ready" | "failed" | "needs_ocr";
  pageCount: number | null; error: string | null; mime: string;
};

const ACCEPT_EXT = ["pdf", "docx", "txt", "md", "png", "jpg", "jpeg", "webp", "gif"];
export const ACCEPT_ATTR = ".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp,image/gif";
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif"];

export function checkFile(file: File): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!ACCEPT_EXT.includes(ext)) return "Only PDF, Word (.docx), text and image files are supported.";
  const max = IMAGE_EXT.includes(ext) ? 5 : 20;
  if (file.size > max * 1024 * 1024) return `Too large — ${IMAGE_EXT.includes(ext) ? "images" : "documents"} can be up to ${max} MB.`;
  return null;
}

export async function uploadFile(file: File, userId: string, projectId?: string): Promise<UploadedFile | { error: string }> {
  const problem = checkFile(file);
  if (problem) return { error: problem };
  const id = crypto.randomUUID();
  const safe = file.name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
  const path = `${userId}/${id}/${safe}`;
  const { error } = await createBrowserSupabase().storage.from("uploads").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) {
    // A missing bucket or storage policy means migration 0002 hasn't been run.
    const setup = /bucket|policy|row-level|not found/i.test(error.message);
    return { error: setup ? "File storage isn't set up yet (run migration 0002 in Supabase)." : "Upload failed. Check your connection and try again." };
  }
  const res = await fetch("/api/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, path, name: file.name, projectId }),
  }).catch(() => null);
  if (!res) return { error: "Upload failed. Check your connection and try again." };
  const out = (await res.json().catch(() => ({}))) as { file?: UploadedFile; error?: string; message?: string };
  if (out.error === "db_setup" && out.message) return { error: out.message };
  if (!res.ok || !out.file) {
    return { error: out.error === "unsupported_type" ? "That file type isn't supported." : out.error === "too_large" ? "That file is too large." : "We couldn't process that file." };
  }
  return out.file;
}
