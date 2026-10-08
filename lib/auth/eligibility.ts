// Access rule: only addresses at the exact domain "uwo.ca" may use Orbit AI.
// This proves the person controls a uwo.ca inbox; it does not prove current enrolment.

const ALLOWED_DOMAIN = "uwo.ca";

// ASCII-only local part, so unicode lookalikes (e.g. Cyrillic letters) are rejected.
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@([a-z0-9.-]+)$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isAllowedEmail(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const email = normalizeEmail(raw);
  const match = EMAIL_PATTERN.exec(email);
  if (!match) return false;
  // Exact domain match: rejects sub.uwo.ca, uwo.ca.evil.com, xuwo.ca, etc.
  return match[1] === ALLOWED_DOMAIN;
}
