import { timingSafeEqual } from "node:crypto";
import { advancePosts } from "@/lib/server/scheduled-posts";

// Scheduled posts' own per-minute cron (Codex 2026-11-15): kept apart from the shared recovery cron
// (/api/internal/generations), so a slow Meta call can never hold up anyone's exports, generations or cleanup.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || secret.length < 32 || got.length !== want.length || !timingSafeEqual(got, want)) return new Response(null, { status: 401 });
  try {
    return Response.json({ ok: true, worked: await advancePosts() });
  } catch (error) {
    console.error("scheduled posts", error);
    return new Response(null, { status: 503 });
  }
}
