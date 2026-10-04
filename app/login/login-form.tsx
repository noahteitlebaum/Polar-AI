"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initial: LoginState = { step: "email", email: "" };

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100";
const button =
  "w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initial);

  if (state.step === "email") {
    return (
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="send" />
        <label htmlFor="email" className="text-sm font-medium">Western email</label>
        <input id="email" name="email" type="email" required autoComplete="email" inputMode="email"
          placeholder="you@uwo.ca" defaultValue={state.email} className={input} />
        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Sending…" : "Send code"}
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{state.message ?? `We sent a code to ${state.email}.`}</p>
      <input type="hidden" name="email" value={state.email} />
      <label htmlFor="code" className="text-sm font-medium">Or enter the code, if your email has one</label>
      <input id="code" name="code" autoComplete="one-time-code" inputMode="numeric"
        maxLength={10} placeholder="123456" className={`${input} tracking-widest`} />
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" name="intent" value="verify" disabled={pending} className={button}>
        {pending ? "Checking…" : "Sign in with code"}
      </button>
      <button type="submit" name="intent" value="restart" formNoValidate className="text-sm underline">
        Use a different email
      </button>
    </form>
  );
}
