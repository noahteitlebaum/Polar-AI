import { isUuid, json, requireAppUser } from "@/lib/api";

// PATCH  /api/projects/:id { name?, instructions? }
// DELETE /api/projects/:id   (its chats stay, moved out of the project)
export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "not_found" }, 404);
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; instructions?: unknown };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (typeof body.instructions === "string") patch.instructions = body.instructions.slice(0, 8000);
  const { data, error } = await auth.supabase.from("projects").update(patch).eq("id", id).select("id, name, instructions, updated_at").maybeSingle();
  if (error) return json({ error: "save_failed" }, 400);
  if (!data) return json({ error: "not_found" }, 404);
  return json({ project: data });
}

export async function DELETE(_: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "not_found" }, 404);
  const { error } = await auth.supabase.from("projects").delete().eq("id", id);
  if (error) return json({ error: "delete_failed" }, 500);
  return json({ ok: true });
}
