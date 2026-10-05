import { AuthCard, TextLink } from "@/components/auth-ui";
import { ResetForm } from "./reset-form";

export default function ResetPage() {
  return (
    <AuthCard
      title="Reset your password"
      subtitle="We'll email a code to your @uwo.ca address."
      footer={<>Remembered it? <TextLink href="/login">Sign in</TextLink></>}
    >
      <ResetForm />
    </AuthCard>
  );
}
