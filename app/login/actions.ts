"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth/eligibility";
import { friendlyAuthError, logAuthError } from "@/lib/auth/errors";
import { resendSignupCode, verifyEmailCode } from "@/lib/auth/flows";

export type SignInState = {
  step: "credentials" | "verify";
  email: string;
  error?: string;
  message?: string;
};

const NOT_UWO = "Orbit AI is only open to @uwo.ca email addresses.";

export async function signInAction(prev: SignInState, formData: FormData): Promise<SignInState> {
  const intent = String(formData.get("intent") ?? "signin");
  const email = normalizeEmail(String(formData.get("email") ?? prev.email ?? ""));

  if (intent === "back") return { step: "credentials", email };
  if (!isAllowedEmail(email)) return { step: "credentials", email, error: NOT_UWO };

  // Account exists but email was never confirmed: finish verification here.
  if (intent === "verify") {
    const problem = await verifyEmailCode(email, String(formData.get("code") ?? ""));
    if (problem) return { step: "verify", email, error: problem };
    redirect("/");
  }
  if (intent === "resend") {
    const problem = await resendSignupCode(email);
    return problem
      ? { step: "verify", email, error: problem }
      : { step: "verify", email, message: `We sent a new code to ${email}.` };
  }

  const password = String(formData.get("password") ?? "");
  if (!password) return { step: "credentials", email, error: "Enter your password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error?.code === "email_not_confirmed") {
    const problem = await resendSignupCode(email);
    return {
      step: "verify",
      email,
      error: problem ?? undefined,
      message: problem ? undefined : `Your email isn't verified yet. We sent a code to ${email}.`,
    };
  }
  if (error || !data.user) {
    if (error && error.code !== "invalid_credentials") logAuthError("signInWithPassword", error);
    return { step: "credentials", email, error: friendlyAuthError(error, "signin") };
  }
  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    return { step: "credentials", email: "", error: NOT_UWO };
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
