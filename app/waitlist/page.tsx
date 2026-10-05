import { redirect } from "next/navigation";
import { getUserAccess } from "@/lib/auth/session";
import { signOut } from "../login/actions";

export const metadata = { title: "You're on the waitlist · Polar AI" };

export default async function WaitlistPage() {
  const result = await getUserAccess();
  if (!result) redirect("/login");
  if (result.access === "app") redirect("/");

  const joined = new Date(result.user.created_at).toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Toronto",
  });

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-md text-center">
        <p className="text-lg font-semibold tracking-tight">Polar AI</p>
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-xl text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" aria-hidden>
            ✓
          </div>
          <h1 className="mt-4 text-2xl font-semibold">You&apos;re on the waitlist</h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            Thanks for signing up. Polar AI brings GPT, Claude, Gemini and Grok together in one place for
            Western students, and we&apos;re opening access soon.
          </p>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            We&apos;ll email <span className="font-medium text-zinc-900 dark:text-zinc-100">{result.user.email}</span>{" "}
            as soon as your spot opens.
          </p>
          <p className="mt-6 text-xs text-zinc-500">Joined {joined}</p>
        </div>
        <form action={signOut} className="mt-4">
          <button className="text-sm text-zinc-600 underline underline-offset-2 dark:text-zinc-400">Sign out</button>
        </form>
      </div>
    </main>
  );
}
