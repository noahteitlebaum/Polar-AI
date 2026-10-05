// Shared password rules (Supabase also enforces its own minimum).
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // bcrypt limit

export function passwordProblem(password: string, confirm?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return "Include at least one letter and one number.";
  if (confirm !== undefined && password !== confirm) return "Passwords don't match.";
  return null;
}
