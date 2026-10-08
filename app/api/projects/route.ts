import { isProvider } from "@/config/models";
import { dbError, json, requireAppUser } from "@/lib/api";

// Courses (stored as "projects"). New ones are shared by all four apps (provider = null).
// GET  /api/projects?provider=… → courses visible in this app
// POST /api/projects { name, instructions? }
export async function GET(request: Request) {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  const provider = new URL(request.url).searchParams.get("provider");
  if (!isProvider(provider)) return json({ error: "bad_request" }, 400);
  const { data, error } = await auth.supabase
    .from("projects")
    .select("id, name, instructions, updated_at")
    .or(`provider.is.null,provider.eq.${provider}`)
    .order("updated_at", { ascending: false });
  if (error) return dbError(error, "load_failed");
  return json({ projects: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; instructions?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const instructions = typeof body.instructions === "string" ? body.instructions.slice(0, 8000) : "";
  if (!name) return json({ error: "bad_request" }, 400);
  const { data, error } = await auth.supabase
    .from("projects")
    .insert({ user_id: auth.user.id, provider: null, name, instructions })
    .select("id, name, instructions, updated_at")
    .single();
  if (error) return dbError(error, "save_failed");
  return json({ project: data });
}
