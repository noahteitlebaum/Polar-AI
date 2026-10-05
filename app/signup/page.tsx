import { redirect } from "next/navigation";
import { getEligibleUser } from "@/lib/auth/session";
import { AuthCard, TextLink } from "@/components/auth-ui";
import { SignUpForm } from "./signup-form";

export default async function SignUpPage() {
  if (await getEligibleUser()) redirect("/");

  return (
    <AuthCard
      title="Create your account"
      subtitle="For Western students. We'll email you a code once to confirm your @uwo.ca address."
      footer={<>Already have an account? <TextLink href="/login">Sign in</TextLink></>}
    >
      <SignUpForm />
    </AuthCard>
  );
}
