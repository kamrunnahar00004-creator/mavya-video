import { connection } from "next/server";
import { getTemplates, setTemplates } from "@/lib/server/scheduled-posts";
import { noStore, postsUser, unavailable } from "@/lib/server/posts-route";
import { CAPTION_MAX, TARGETS, type Templates } from "@/lib/scheduled-posts";

/** The caption templates ({hook} = the video's hook words). */
export async function GET() {
  await connection();
  const user = await postsUser();
  if ("response" in user) return user.response;
  try { return Response.json({ templates: await getTemplates(user.who) }, { headers: noStore }); }
  catch (error) { return unavailable(error); }
}

export async function PUT(request: Request) {
  const user = await postsUser();
  if ("response" in user) return user.response;
  const body = (await request.json().catch(() => null)) as { templates?: Partial<Templates> } | null;
  const t = body?.templates;
  if (!t || !TARGETS.every((k) => typeof t[k] === "string" && t[k]!.length <= CAPTION_MAX)) return Response.json({ error: `Each caption can be up to ${CAPTION_MAX} characters.` }, { status: 400 });
  try { await setTemplates(user.who, { instagram: t.instagram!, facebook: t.facebook! }); return Response.json({ templates: t }); }
  catch (error) { return unavailable(error); }
}
