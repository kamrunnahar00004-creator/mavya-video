import "server-only";
import type { Source } from "@/lib/first-touch";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Saves where a new account came from (src/lib/first-touch.ts) in its app_metadata (`signup_source`): no migration,
 * and only the server can write it. Set once: an account that already has one keeps it. Never blocks or fails signup.
 */
export async function saveSource(userId: string, source: Source, db = createSupabaseAdminClient()): Promise<boolean> {
  try {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error || !data?.user) return false;
    if (data.user.app_metadata?.signup_source) return false;
    // GoTrue merges app_metadata keys, so provider info stays as it is.
    const { error: e } = await db.auth.admin.updateUserById(userId, { app_metadata: { signup_source: source } });
    if (e) { console.error("signup source", e.status ?? "error"); return false; }
    return true;
  } catch {
    console.error("signup source", "network");
    return false;
  }
}
