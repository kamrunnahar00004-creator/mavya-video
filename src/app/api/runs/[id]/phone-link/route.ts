import { getRun } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";
import { makePhoneToken, mayUpload } from "@/lib/server/phone-link";

/** The QR code's link for "Upload from phone" (src/lib/server/phone-link.ts): this video only, for an hour. */
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/phone-link">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  if (!(await getRun(id, who))) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await mayUpload(who))) return Response.json({ error: "Choose a plan to upload." }, { status: 402 });
  const { token, expiresAt } = makePhoneToken(who, id);
  return Response.json({ url: `${new URL(request.url).origin}/phone/${token}`, expiresAt });
}
