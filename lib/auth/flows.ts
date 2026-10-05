import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "./eligibility";
import { friendlyAuthError, logAuthError } from "./errors";

// Confirms an email with the one-time code from the sign-up email. Leaves the user signed in.
export async function verifyEmailCode(email: string, rawCode: string): Promise<string | null> {
  const token = rawCode.replace(/\s/g, "");
  if (!/^\d{6,10}$/.test(token)) return "Enter the code from your email.";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) {
    if (error) logAuthError("verifyOtp", error);
    return friendlyAuthError(error, "verify");
  }
  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    return "Polar AI is only open to @uwo.ca email addresses.";
  }
  return null;
}

// Sends a fresh sign-up verification code.
export async function resendSignupCode(email: string): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) {
    logAuthError("resend", error);
    return friendlyAuthError(error, "send");
  }
  return null;
}
