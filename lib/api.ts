import { getUserAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Shared guard for API routes: verified @uwo.ca account that is past the waitlist.
// Returns the user plus a Supabase client bound to their session (RLS applies to every query).
type AppUser = { user: NonNullable<Awaited<ReturnType<typeof getUserAccess>>>["user"]; supabase: Awaited<ReturnType<typeof createClient>> };

export async function requireAppUser(): Promise<{ error: Response } | AppUser> {
  const result = await getUserAccess();
  if (!result) return { error: Response.json({ error: "not_signed_in" }, { status: 401 }) };
  if (result.access !== "app") return { error: Response.json({ error: "waitlisted" }, { status: 403 }) };
  return { user: result.user, supabase: await createClient() };
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
