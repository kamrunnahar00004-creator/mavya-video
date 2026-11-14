import { deletePost, retryPost, updatePost } from "@/lib/server/scheduled-posts";
import { postsUser, unavailable } from "@/lib/server/posts-route";
import type { Post, Target } from "@/lib/scheduled-posts";

/** { at, targets, captions } edits a post that hasn't started; { retry: true } sends a failed one again. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const user = await postsUser();
  if ("response" in user) return user.response;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { retry?: unknown; at?: string; targets?: Target[]; captions?: Post["captions"] } | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    const out = body.retry === true ? await retryPost(user.who, id) : await updatePost(user.who, id, { at: body.at as string, targets: body.targets as Target[], captions: body.captions ?? {} });
    return "error" in out ? Response.json(out, { status: 409 }) : Response.json(out);
  } catch (error) { return unavailable(error); }
}

/** Removes a post from the calendar (it stays on Instagram and Facebook if it went out). */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const user = await postsUser();
  if ("response" in user) return user.response;
  const { id } = await ctx.params;
  try {
    return (await deletePost(user.who, id)) ? Response.json({ ok: true }) : Response.json({ error: "It's being posted right now. Try again in a minute." }, { status: 409 });
  } catch (error) { return unavailable(error); }
}
