import { deletePost, updatePost, type Mark } from "@/lib/server/scheduled-posts";
import { postsUser, unavailable } from "@/lib/server/posts-route";
import type { Post, Target } from "@/lib/scheduled-posts";

/** { at, targets, captions, marks } edits a post: its time, platforms, captions, and each platform's posted record. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const user = await postsUser();
  if ("response" in user) return user.response;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { at?: string; targets?: Target[]; captions?: Post["captions"]; marks?: Partial<Record<Target, Mark>>; rev?: unknown } | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    const marks = body.marks && typeof body.marks === "object" ? body.marks : undefined;
    const out = await updatePost(user.who, id, { at: body.at as string, targets: body.targets as Target[], captions: body.captions ?? {}, marks, rev: body.rev });
    return "error" in out ? Response.json(out, { status: /changed|removed/.test(out.error) ? 409 : 400 }) : Response.json(out);
  } catch (error) { return unavailable(error); }
}

/** Removes a post from the calendar (it stays wherever it was posted). */
export async function DELETE(request: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const user = await postsUser();
  if ("response" in user) return user.response;
  const { id } = await ctx.params;
  const rev = new URL(request.url).searchParams.get("rev") ?? undefined;
  try {
    const out = await deletePost(user.who, id, rev);
    if (out === "changed") return Response.json({ error: "This post changed. Open it again." }, { status: 409 });
    return out === "ok" ? Response.json({ ok: true }) : Response.json({ error: "This post was already removed." }, { status: 404 });
  } catch (error) { return unavailable(error); }
}
