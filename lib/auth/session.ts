import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "./eligibility";

// Server-side source of truth for "may this request use the app?".
// Every page, server action and API route that touches chats, credits or models must call this.
export async function getEligibleUser() {
  const supabase = await createClient();
  // getUser() checks the session with Supabase's servers, so it can't be faked with a cookie.
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user) return null;
  if (!user.email_confirmed_at) return null;
  if (!isAllowedEmail(user.email)) return null;
  return user;
}
