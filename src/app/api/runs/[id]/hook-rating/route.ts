import { hookRating, rateHook } from "@/lib/server/hook-eval";
import { currentUser, signInFirst } from "@/lib/server/who";

/** The saved rating for this video's hook clip: ?src=/api/media/<id>.mp4. */
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/hook-rating">) {
  const who = await currentUser();
  if (!who) return signInFirst();
  const { id } = await ctx.params;
  const src = new URL(request.url).searchParams.get("src") ?? "";
  try { return Response.json({ rating: await hookRating(who, id, src) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { console.error("hook rating", error); return Response.json({ rating: 0 }); }
}

/** Thumbs up or down on the hook now in this video: { src, rating: 1 | -1 | 0 }. */
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/hook-rating">) {
  const who = await currentUser();
  if (!who) return signInFirst();
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { src?: unknown; rating?: unknown } | null;
  if (typeof body?.src !== "string" || typeof body.rating !== "number") return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    return (await rateHook(who, id, body.src, body.rating)) ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("hook rating", error);
    return Response.json({ error: "Couldn't save that. Try again." }, { status: 503 });
  }
}
