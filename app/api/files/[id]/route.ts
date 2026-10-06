import { isUuid, json, requireAppUser } from "@/lib/api";

// DELETE /api/files/:id → removes the stored file, its passages, and its row.
export async function DELETE(_: Request, ctx: RouteContext<"/api/files/[id]">) {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "not_found" }, 404);
  const { data: file } = await auth.supabase.from("files").select("storage_path").eq("id", id).maybeSingle();
  if (!file) return json({ error: "not_found" }, 404);
  await auth.supabase.storage.from("uploads").remove([file.storage_path]);
  const { error } = await auth.supabase.from("files").delete().eq("id", id);
  if (error) return json({ error: "delete_failed" }, 500);
  return json({ ok: true });
}
