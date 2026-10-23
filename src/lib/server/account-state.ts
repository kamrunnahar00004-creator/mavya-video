import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
export async function accountClosing(user: string): Promise<boolean> {
 const { data, error } = await createSupabaseAdminClient().from("account_deletions").select("user_id").eq("user_id", user).maybeSingle();
 if (error) throw error;
 return Boolean(data);
}
