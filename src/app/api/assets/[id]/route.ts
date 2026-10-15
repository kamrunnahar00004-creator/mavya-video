import { deleteAsset, isMediaId } from "@/lib/server/store";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/assets/[id]">) {
  const { id } = await ctx.params;
  if (!isMediaId(id)) return Response.json({ error: "Not found" }, { status: 404 });
  await deleteAsset(id);
  return new Response(null, { status: 204 });
}
