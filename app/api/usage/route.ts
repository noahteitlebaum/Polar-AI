import { json, requireAppUser } from "@/lib/api";
import { getUsage } from "@/lib/billing/budget";
import { isLive, liveProviders } from "@/lib/providers";

// GET /api/usage → { live, allowance, spent, reserved } in micros (millionths of $).
export async function GET() {
  const auth = await requireAppUser();
  if ("error" in auth) return auth.error;
  if (!isLive()) return json({ live: false, liveProviders: [], allowance: 0, spent: 0, reserved: 0 });
  const usage = await getUsage(auth.user.id).catch(() => null);
  if (!usage) return json({ error: "load_failed" }, 500);
  return json({ live: true, liveProviders: liveProviders(), ...usage });
}
