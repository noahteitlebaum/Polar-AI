import { redirect } from "next/navigation";
import { getUserAccess } from "@/lib/auth/session";
import { ChatApp } from "./chat/chat-app";

export default async function Home() {
  const result = await getUserAccess();
  if (!result) redirect("/login");
  if (result.access === "waitlist") redirect("/waitlist");
  return <ChatApp email={result.user.email ?? ""} />;
}
