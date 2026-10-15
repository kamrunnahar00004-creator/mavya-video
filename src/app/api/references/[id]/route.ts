import { deleteReference, getReference, updateReference } from "@/lib/server/store";
import type { Analysis, Reference } from "@/lib/types";

export async function GET(_request: Request, ctx: RouteContext<"/api/references/[id]">) {
  const { id } = await ctx.params;
  const ref = await getReference(id);
  return ref ? Response.json(ref) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/references/[id]">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Partial<Reference> | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });

  const patch: Partial<Pick<Reference, "title" | "platform" | "sourceUrl" | "views" | "analysis" | "pending" | "review">> = {};
  if (typeof body.title === "string") patch.title = body.title.trim().slice(0, 120) || "Untitled reference";
  if (typeof body.sourceUrl === "string") patch.sourceUrl = body.sourceUrl.trim().slice(0, 500);
  if (body.views === null || (typeof body.views === "number" && body.views >= 0)) patch.views = body.views;
  if (body.analysis && typeof body.analysis === "object") patch.analysis = body.analysis as Analysis;
  if (body.review !== undefined) {
    // Keep/drop labels on the shared library: curator's machine only.
    if (process.env.CURATOR !== "1") return Response.json({ error: "Forbidden" }, { status: 403 });
    const v = body.review?.verdict;
    if (v !== "keep" && v !== "drop") return Response.json({ error: "Bad review" }, { status: 400 });
    const reason = typeof body.review?.reason === "string" ? body.review.reason.trim().slice(0, 80) : undefined;
    patch.review = { verdict: v, ...(reason ? { reason } : {}), at: new Date().toISOString() };
    patch.pending = false;
  }

  const ref = await updateReference(id, patch);
  return ref ? Response.json(ref) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/references/[id]">) {
  const { id } = await ctx.params;
  const ref = await getReference(id);
  if (!ref) return new Response(null, { status: 204 });
  // The hook library is curated: only the curator's machine may remove from it.
  if ((ref.owner ?? "curated") === "curated" && process.env.CURATOR !== "1") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteReference(id);
  return new Response(null, { status: 204 });
}
