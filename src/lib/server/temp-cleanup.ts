import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { deleteObjectStrict } from "@/lib/server/r2";
export async function expireTemporaryObjects() {
 const db = createSupabaseAdminClient();
 const { data, error } = await db.from("temporary_objects").select("key").lt("expires_at", new Date().toISOString()).limit(5);
 if (error) throw error;
 for (const item of data ?? []) {
  await deleteObjectStrict(item.key);
  const removed = await db.from("temporary_objects").delete().eq("key", item.key);
  if (removed.error) throw removed.error;
 }
 return data?.length ?? 0;
}
