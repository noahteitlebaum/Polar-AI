import { redirect } from "next/navigation";
import { getEligibleUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  link_expired: "That sign-in link is expired or was opened in a different browser. Request a new one.",
  not_uwo: "Polar AI is only open to @uwo.ca email addresses.",
  missing_code: "That sign-in link is incomplete. Request a new one.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (await getEligibleUser()) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm dark:bg-zinc-900">
        <h1 className="mb-1 text-2xl font-semibold">Polar AI</h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Sign in with your @uwo.ca email. We&apos;ll email you a sign-in link.
        </p>
        {error && ERRORS[error] && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {ERRORS[error]}
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
