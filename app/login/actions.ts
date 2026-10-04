"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth/eligibility";

export type LoginState = {
  step: "email" | "code";
  email: string;
  error?: string;
  message?: string;
};

async function sendCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  // Server-side check: the browser can't skip this.
  if (!isAllowedEmail(email)) {
    return { step: "email", email, error: "Polar AI is only open to @uwo.ca email addresses." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // The email has a sign-in link that comes back to /auth/callback.
    // (Once custom SMTP is set up, the email can also show a typed code.)
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    console.error("sendCode failed", { code: error.code, status: error.status });
    return { step: "email", email, error: "We couldn't send a code right now. Try again in a minute." };
  }

  return { step: "code", email, message: `We sent a sign-in link to ${email}. Open it on this device.` };
}

async function verifyCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const token = String(formData.get("code") ?? "").replace(/\s/g, "");

  if (!isAllowedEmail(email)) {
    return { step: "email", email, error: "Polar AI is only open to @uwo.ca email addresses." };
  }
  if (!/^\d{6,10}$/.test(token)) {
    return { step: "code", email, error: "Enter the code from your email." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error || !data.user) {
    return { step: "code", email, error: "That code is wrong or expired. Try again or request a new one." };
  }

  // Double-check the verified account itself.
  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    return { step: "email", email: "", error: "Polar AI is only open to @uwo.ca email addresses." };
  }

  redirect("/");
}

// One entry point so the form keeps a single state.
export async function loginAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  if (formData.get("intent") === "restart") return { step: "email", email: "" };
  return formData.get("intent") === "verify" ? verifyCode(prev, formData) : sendCode(prev, formData);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
