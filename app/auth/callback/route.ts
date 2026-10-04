import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/eligibility";

// The sign-in link in the email lands here with a one-time ?code=...
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));

  if (!code) return fail("missing_code");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail("link_expired");

  // Server-side domain check again, on the verified account.
  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    return fail("not_uwo");
  }

  return NextResponse.redirect(new URL("/", url.origin));
}
