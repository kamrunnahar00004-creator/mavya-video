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
  // One unit of work per tick. The kind that goes first rotates every minute, so a backlog or a repeatedly failing
  // item of one kind can never starve the others (Codex V7). Each step returns true when it did work.
  const now = () => new Date().toISOString();
  const steps: (() => Promise<boolean>)[] = [
    async () => {
      const deletion = await createSupabaseAdminClient().from("account_deletions").select("user_id")
        .neq("state", "done").or(`lease_until.is.null,lease_until.lt.${now()}`)
        .or(`state.eq.cancel,cleanup_after.lte.${now()}`)
        .order("updated_at").limit(1);
      if (deletion.error) throw deletion.error;
      if (!deletion.data?.[0]) return false;
      await advanceDeletion(deletion.data[0].user_id);
      return true;
    },
    async () => Boolean(await expireUploads()),
    async () => Boolean(await expireTemporaryObjects()),
    async () => {
      const exports = await createSupabaseAdminClient().from("export_jobs").select("id,user_id")
        .or("state.in.(pending,running),cleaned.eq.false").or(`lease_until.is.null,lease_until.lt.${now()}`)
        .order("updated_at").limit(1);
      if (exports.error) throw exports.error;
      if (!exports.data?.[0]) return false;
      await advanceExport(exports.data[0].user_id, exports.data[0].id);
      return true;
    },
    async () => {
      const { data, error } = await createSupabaseAdminClient().from("generations").select("id, user_id")
        .in("state", ["reserved", "starting", "running"]).or(`lease_until.is.null,lease_until.lt.${now()}`)
        .order("updated_at").limit(1);
      if (error) throw error;
      if (!data?.[0]) return false;
      await advanceGeneration(data[0].user_id, data[0].id);
      return true;
    },
  ];
  const first = Math.floor(Date.now() / 60_000) % steps.length;
  let failed = false;
  // A step can take up to ~240 s (a generation's setup plus settlement). Start one only while the tick is young, so
  // slow failures earlier in the loop can never push the whole invocation past the 300 s limit (Codex P2V3).
  const started = Date.now();
  const START_WINDOW_MS = 30_000;
  for (let i = 0; i < steps.length; i++) {
    if (i > 0 && Date.now() - started > START_WINDOW_MS) break;
    try {
      if (await steps[(first + i) % steps.length]()) return Response.json({ ok: true });
    } catch (error) {
      // One kind failing does not stop the others this tick.
      console.error("recovery step", (first + i) % steps.length, error);
      failed = true;
    }
  }
  return failed ? new Response(null, { status: 503 }) : Response.json({ ok: true });
}
