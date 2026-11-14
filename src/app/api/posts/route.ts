import { connection } from "next/server";
import { createPosts, listPosts, type NewPost } from "@/lib/server/scheduled-posts";
import { noStore, postsUser, unavailable } from "@/lib/server/posts-route";

/** The calendar's posts between `from` and `to` (ISO times, at most 62 days apart). */
export async function GET(request: Request) {
  await connection();
  const user = await postsUser();
  if ("response" in user) return user.response;
  const q = new URL(request.url).searchParams;
  const from = Date.parse(q.get("from") ?? ""), to = Date.parse(q.get("to") ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 62 * 86_400_000) return Response.json({ error: "Bad request" }, { status: 400 });
  try { return Response.json({ posts: await listPosts(user.who, new Date(from).toISOString(), new Date(to).toISOString()), now: Date.now() }, { headers: noStore }); }
  catch (error) { return unavailable(error); }
}

/** Schedules a batch: { items: [{ mediaId, at, targets, captions, title, hook }] }. */
export async function POST(request: Request) {
  const user = await postsUser();
  if ("response" in user) return user.response;
  const body = (await request.json().catch(() => null)) as { items?: NewPost[] } | null;
  try {
    const out = await createPosts(user.who, body?.items ?? []);
    return "error" in out ? Response.json(out, { status: 400 }) : Response.json(out);
  } catch (error) { return unavailable(error); }
}
