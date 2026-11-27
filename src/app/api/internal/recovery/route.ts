import { timingSafeEqual } from "node:crypto";
import { runRecovery } from "@/lib/server/checkout-recovery";

// Checkout recovery emails' cron (founder 2026-11-27), every 15 minutes: see src/lib/server/checkout-recovery.ts.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || secret.length < 32 || got.length !== want.length || !timingSafeEqual(got, want)) return new Response(null, { status: 401 });
  try {
    return Response.json({ ok: true, sent: await runRecovery() });
  } catch (error) {
    console.error("checkout recovery", error);
    return new Response(null, { status: 503 });
  }
}
