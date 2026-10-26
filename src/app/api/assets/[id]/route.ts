import { deleteAsset, isMediaId } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/assets/[id]">) {
  const { id } = await ctx.params;
  if (!isMediaId(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const who = await currentUser();
  if (!who) return signInFirst();
  try { await deleteAsset(id, who); }
  catch { return Response.json({ error: "Couldn't delete the file. Try again." }, { status: 503 }); }
  return new Response(null, { status: 204 });
}
