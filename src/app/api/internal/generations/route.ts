import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { advanceGeneration } from "@/lib/server/generation-jobs";
import { advanceDeletion } from "@/lib/server/account-deletion";
import { expireUploads } from "@/lib/server/uploads";
import { advanceExport } from "@/lib/server/export-jobs";
import { expireTemporaryObjects } from "@/lib/server/temp-cleanup";

// Keep each invocation within the configured Pro function budget.
export const maxDuration = 300;
/** Per-minute recovery advances durable deletion/cleanup/export/generation work. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || secret.length < 32 || got.length !== want.length || !timingSafeEqual(got, want)) return new Response(null, { status: 401 });
  const deletion = await createSupabaseAdminClient().from("account_deletions").select("user_id")
    .neq("state", "done").or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .or(`state.eq.cancel,cleanup_after.lte.${new Date().toISOString()}`)
    .order("updated_at").limit(1);
  if (deletion.error) return new Response(null, { status: 503 });
  if (deletion.data?.[0]) {
    await advanceDeletion(deletion.data[0].user_id);
    return Response.json({ ok: true });
  }
  if (await expireUploads()) return Response.json({ ok: true });
  if (await expireTemporaryObjects()) return Response.json({ ok: true });
  const exports = await createSupabaseAdminClient().from("export_jobs").select("id,user_id")
    .or("state.in.(pending,running),cleaned.eq.false").or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .order("updated_at").limit(1);
  if (exports.error) return new Response(null, { status: 503 });
  if (exports.data?.[0]) { await advanceExport(exports.data[0].user_id, exports.data[0].id); return Response.json({ ok: true }); }
  const { data, error } = await createSupabaseAdminClient().from("generations").select("id, user_id")
    .in("state", ["reserved", "starting", "running"]).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .order("updated_at").limit(1);
  if (error) return new Response(null, { status: 503 });
  if (data?.[0]) await advanceGeneration(data[0].user_id, data[0].id);
  return Response.json({ ok: true });
}
