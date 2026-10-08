"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth/eligibility";
import { friendlyAuthError, logAuthError } from "@/lib/auth/errors";
import { passwordProblem } from "@/lib/auth/password";

export type ResetState = {
  step: "email" | "code";
  email: string;
  error?: string;
  message?: string;
};

export async function resetAction(prev: ResetState, formData: FormData): Promise<ResetState> {
  const intent = String(formData.get("intent") ?? "send");
  const email = normalizeEmail(String(formData.get("email") ?? prev.email ?? ""));

  if (intent === "back") return { step: "email", email };
  if (!isAllowedEmail(email)) {
    return { step: "email", email, error: "Orbit AI is only open to @uwo.ca email addresses." };
  }

  const supabase = await createClient();

  if (intent === "send") {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      logAuthError("resetPasswordForEmail", error);
      return { step: prev.step, email, error: friendlyAuthError(error, "send") };
    }
    // Same message whether or not the account exists, so emails can't be probed.
    return { step: "code", email, message: `If ${email} has an account, we sent it a 6-digit code.` };
  }

  // intent === "reset"
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password, String(formData.get("confirm") ?? ""));
  if (problem) return { step: "code", email, error: problem };

  // If the code was already accepted on an earlier try (e.g. the password was rejected),
  // the user is signed in for this email and the code doesn't need to be used again.
  const { data: current } = await supabase.auth.getUser();
  if (current.user?.email?.toLowerCase() !== email) {
    const token = String(formData.get("code") ?? "").replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(token)) return { step: "code", email, error: "Enter the code from your email." };
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "recovery" });
    if (error) {
      logAuthError("verifyOtp(recovery)", error);
      return { step: "code", email, error: friendlyAuthError(error, "verify") };
    }
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logAuthError("updateUser(password)", error);
    return { step: "code", email, error: friendlyAuthError(error, "password") };
  }

  redirect("/");
}
