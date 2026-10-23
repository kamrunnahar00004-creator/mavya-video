import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { advanceGeneration } from "@/lib/server/generation-jobs";

// Hobby plan maximum (founder 2026-10-23: stay on Hobby for now); one Kling start or check fits well inside it.
export const maxDuration = 300;
/** Scheduled recovery continues only previously reserved, explicit-click jobs. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || secret.length < 32 || got.length !== want.length || !timingSafeEqual(got, want)) return new Response(null, { status: 401 });
  const { data, error } = await createSupabaseAdminClient().from("generations").select("id, user_id")
    .in("state", ["reserved", "starting", "running"]).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .order("updated_at").limit(1);
  if (error) return new Response(null, { status: 503 });
  if (data?.[0]) await advanceGeneration(data[0].user_id, data[0].id);
  return Response.json({ ok: true });
}
