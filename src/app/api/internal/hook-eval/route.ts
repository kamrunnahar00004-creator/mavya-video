import { timingSafeEqual } from "node:crypto";
import { evalDue } from "@/lib/server/hook-eval";

// Hook eval's own cron (founder 2026-11-26), every 5 minutes: scores new hooks after delivery, apart from the shared
// recovery cron so a slow Gemini call never holds up exports or generations.
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || secret.length < 32 || got.length !== want.length || !timingSafeEqual(got, want)) return new Response(null, { status: 401 });
  try {
    return Response.json({ ok: true, scored: await evalDue() });
  } catch (error) {
    console.error("hook eval", error);
    return new Response(null, { status: 503 });
  }
}
