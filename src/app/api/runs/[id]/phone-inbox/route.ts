import { getRun } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";
import { clearInbox, readInbox } from "@/lib/server/phone-link";

/** Videos sent from the phone for this video, waiting to be placed (GET), and marking them placed (POST { keys }). */
export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[id]/phone-inbox">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  if (!(await getRun(id, who))) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ clips: await readInbox(id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/phone-inbox">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  if (!(await getRun(id, who))) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { keys?: unknown } | null;
  await clearInbox(id, Array.isArray(body?.keys) ? (body.keys as string[]) : []);
  return Response.json({ ok: true });
}
