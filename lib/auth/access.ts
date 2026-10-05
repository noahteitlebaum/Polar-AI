import { normalizeEmail } from "./eligibility";

// Who gets into the app vs. the waitlist.
// WAITLIST_MODE=off opens the app to every verified @uwo.ca account.
// EARLY_ACCESS_EMAILS (comma-separated) lets the team and testers in while the waitlist is on.
export type Access = "app" | "waitlist";

export function accessFor(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Access {
  if (!email) return "waitlist";
  if ((env.WAITLIST_MODE ?? "on").trim().toLowerCase() === "off") return "app";
  const allowed = (env.EARLY_ACCESS_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
  return allowed.includes(normalizeEmail(email)) ? "app" : "waitlist";
}
