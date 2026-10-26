import { getReference } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";
/** Tiny analysis thumbnails travel as browser-cacheable images, never base64 in list JSON. */
export async function GET(request: Request, ctx: RouteContext<"/api/references/[id]/thumbnail">) {
  const who = await currentUser();
  if (!who) return signInFirst();
  const index = Number(new URL(request.url).searchParams.get("segment") ?? 0);
  if (!Number.isInteger(index) || index < 0 || index > 200) return new Response(null, { status: 404 });
  const ref = await getReference((await ctx.params).id, who);
  const image = ref?.analysis?.segments[index]?.thumb;
  const match = image?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[2].length > 4_000_000) return new Response(null, { status: 404 });
  return new Response(Buffer.from(match[2], "base64"), { headers: { "Content-Type": match[1], "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
