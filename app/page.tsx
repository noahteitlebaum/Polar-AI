import { redirect } from "next/navigation";
import { getEligibleUser } from "@/lib/auth/session";
import { ChatApp } from "./chat/chat-app";

export default async function Home() {
  const user = await getEligibleUser();
  if (!user) redirect("/login");
  return <ChatApp email={user.email ?? ""} />;
}
