import { isProvider } from "@/config/models";
import { json, requireAppUser } from "@/lib/api";

// GET  /api/projects?provider=… → this app's projects
// POST /api/projects { provider, name, instructions? }
export async function GET(request: Request) {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  const provider = new URL(request.url).searchParams.get("provider");
  if (!isProvider(provider)) return json({ error: "bad_request" }, 400);
  const { data, error } = await auth.supabase
    .from("projects")
    .select("id, name, instructions, updated_at")
    .eq("provider", provider)
    .order("updated_at", { ascending: false });
  if (error) return json({ error: "load_failed" }, 500);
  return json({ projects: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => ({}))) as { provider?: unknown; name?: unknown; instructions?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const instructions = typeof body.instructions === "string" ? body.instructions.slice(0, 8000) : "";
  if (!isProvider(body.provider) || !name) return json({ error: "bad_request" }, 400);
  const { data, error } = await auth.supabase
    .from("projects")
    .insert({ user_id: auth.user.id, provider: body.provider, name, instructions })
    .select("id, name, instructions, updated_at")
    .single();
  if (error) return json({ error: "save_failed" }, 500);
  return json({ project: data });
}
