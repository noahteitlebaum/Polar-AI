"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormAlert, linkButtonClass, primaryButtonClass } from "@/components/auth-ui";
import { signInAction, type SignInState } from "./actions";

export function LoginForm({ initialMessage }: { initialMessage?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, {
    step: "credentials",
    email: "",
    message: initialMessage,
  });

  if (state.step === "verify") {
    return (
      <form action={action} className="flex flex-col gap-4">
        <FormAlert error={state.error} message={state.message} />
        <input type="hidden" name="email" value={state.email} />
        <Field label="Verification code" id="code" required autoComplete="one-time-code" inputMode="numeric"
          maxLength={10} placeholder="123456" autoFocus />
        <button type="submit" name="intent" value="verify" disabled={pending} className={primaryButtonClass}>
          {pending ? "Checking…" : "Verify and sign in"}
        </button>
        <div className="flex justify-between">
          <button type="submit" name="intent" value="resend" formNoValidate disabled={pending} className={linkButtonClass}>
            Send a new code
          </button>
          <button type="submit" name="intent" value="back" formNoValidate disabled={pending} className={linkButtonClass}>
            Back
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormAlert error={state.error} message={state.message} />
      <Field label="Western email" id="email" type="email" required autoComplete="email" inputMode="email"
        placeholder="you@uwo.ca" defaultValue={state.email} key={state.email} />
      <Field label="Password" id="password" type="password" required autoComplete="current-password" />
      <div className="-mt-2 text-right">
        <Link href="/reset" className="text-sm text-ink-muted underline underline-offset-[3px]">
          Forgot password?
        </Link>
      </div>
      <button type="submit" name="intent" value="signin" disabled={pending} className={primaryButtonClass}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
