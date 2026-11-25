import { connection } from "next/server";
import { getSetup, saveSetup } from "@/lib/server/scheduled-posts";
import { noStore, postsUser, unavailable } from "@/lib/server/posts-route";

/** The caption templates ({hook}, {domain}, {hashtags}) and the app they are filled from. */
export async function GET() {
  await connection();
  const user = await postsUser();
  if ("response" in user) return user.response;
  try { return Response.json(await getSetup(user.who), { headers: noStore }); }
  catch (error) { return unavailable(error); }
}

/** Saves "Your app & captions" in one write: { templates, url, hashtags } (typed by hand, no AI). */
export async function PUT(request: Request) {
  const user = await postsUser();
  if ("response" in user) return user.response;
  const body = (await request.json().catch(() => null)) as { templates?: unknown; url?: unknown; hashtags?: unknown; rev?: unknown } | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    const out = await saveSetup(user.who, body);
    return "error" in out ? Response.json({ error: out.error }, { status: out.stale ? 409 : 400 }) : Response.json(out);
  } catch (error) { return unavailable(error); }
}
