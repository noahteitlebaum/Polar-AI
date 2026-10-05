// Turns Supabase auth errors into messages a student can act on.
type AuthErrorLike = { code?: string; status?: number; message?: string } | null | undefined;

export function friendlyAuthError(error: AuthErrorLike, context: "send" | "verify" | "signin" | "password"): string {
  const code = error?.code;
  switch (code) {
    case "over_email_send_rate_limit":
      return "Please wait a minute before requesting another email.";
    case "over_request_rate_limit":
      return "Too many attempts. Wait a few minutes and try again.";
    case "otp_expired":
    case "invalid_otp":
      return "That code is wrong or expired. Check the newest email or request a new code.";
    case "invalid_credentials":
      return "Email or password is incorrect.";
    case "email_not_confirmed":
      return "Please verify your email first.";
    case "weak_password":
      return "That password is too weak. Use at least 8 characters, including a letter and a number.";
    case "same_password":
      return "Your new password must be different from your old one.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Sign in instead.";
    case "signup_disabled":
      return "Sign-ups are closed right now.";
  }
  if ((error?.status ?? 0) >= 500 && context === "send") {
    return "We couldn't send the email right now. Please try again in a few minutes.";
  }
  if (context === "verify") return "That code is wrong or expired. Request a new code.";
  return "Something went wrong. Please try again.";
}

// Safe to log: no passwords, codes or message content.
export function logAuthError(where: string, error: AuthErrorLike) {
  console.error(`[auth] ${where} failed`, { code: error?.code, status: error?.status, message: error?.message });
}
