"use client";

import { useActionState } from "react";
import { Field, FormAlert, linkButtonClass, primaryButtonClass } from "@/components/auth-ui";
import { PASSWORD_MIN } from "@/lib/auth/password";
import { resetAction, type ResetState } from "./actions";

export function ResetForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetAction, { step: "email", email: "" });

  if (state.step === "code") {
    return (
      <form action={action} className="flex flex-col gap-4">
        <FormAlert error={state.error} message={state.message} />
        <input type="hidden" name="email" value={state.email} />
        <Field label="Code from email" id="code" autoComplete="one-time-code" inputMode="numeric"
          maxLength={10} placeholder="123456" autoFocus />
        <Field label="New password" id="password" type="password" required autoComplete="new-password"
          minLength={PASSWORD_MIN} hint={`At least ${PASSWORD_MIN} characters, with a letter and a number.`} />
        <Field label="Confirm new password" id="confirm" type="password" required autoComplete="new-password"
          minLength={PASSWORD_MIN} />
        <button type="submit" name="intent" value="reset" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving…" : "Set new password"}
        </button>
        <div className="flex justify-between">
          <button type="submit" name="intent" value="send" formNoValidate disabled={pending} className={linkButtonClass}>
            Send a new code
          </button>
          <button type="submit" name="intent" value="back" formNoValidate disabled={pending} className={linkButtonClass}>
            Change email
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
      <button type="submit" name="intent" value="send" disabled={pending} className={primaryButtonClass}>
        {pending ? "Sending…" : "Email me a code"}
      </button>
    </form>
  );
}
