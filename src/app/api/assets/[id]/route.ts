import { deleteAsset, isMediaId } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/assets/[id]">) {
  const { id } = await ctx.params;
  if (!isMediaId(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const who = await currentUser();
  if (!who) return signInFirst();
  await deleteAsset(id, who);
  return new Response(null, { status: 204 });
}
