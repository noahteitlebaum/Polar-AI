import { redirect } from "next/navigation";
import { getUserAccess } from "@/lib/auth/session";
import { AuthShell, linkButtonClass } from "@/components/auth-ui";
import { signOut } from "../login/actions";

export const metadata = { title: "You're on the waitlist · Orbit AI" };

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
    <AuthShell wide>
      <div className="rounded-2xl border border-line bg-surface-100 p-8 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-300 text-xl font-semibold text-success" aria-hidden>
          ✓
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">You&apos;re on the waitlist</h1>
        <p className="mt-3 text-ink-muted">
          Thanks for signing up. Orbit AI brings GPT, Claude, Gemini and Grok together in one place for
          Western students, and we&apos;re opening access soon.
        </p>
        <p className="mt-3 text-ink-muted">
          We&apos;ll email <span className="font-medium text-ink">{result.user.email}</span>{" "}
          as soon as your spot opens.
        </p>
        <p className="mt-6 text-xs text-ink-subtle">Joined {joined}</p>
      </div>
      <form action={signOut} className="mt-4 text-center">
        <button className={linkButtonClass}>Sign out</button>
      </form>
    </AuthShell>
  );
}
