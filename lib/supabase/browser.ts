import { createBrowserClient } from "@supabase/ssr";

// Browser client (publishable key + the student's session cookie). Used only to upload files straight to
// Storage, so big files don't pass through our server. Storage policies limit each student to their own folder.
export function createBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
