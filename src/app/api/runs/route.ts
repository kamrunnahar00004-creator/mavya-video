import { listPage, pageResponse, listError } from "@/lib/server/list-pages";
import { connection } from "next/server";
import { createRun, getReference } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

export async function GET(request: Request) {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  try { const page = await listPage("runs", who, request); return pageResponse(page.items, page.next); } catch (error) { return listError(error); }
}

export async function POST(request: Request) {
  const who = await currentUser();
  if (!who) return signInFirst();
  const body = await request.json().catch(() => null) as { id?: unknown; sourceRefId?: unknown } | null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (body?.id !== undefined && (typeof body.id !== "string" || !uuid.test(body.id))) return Response.json({ error: "Invalid video identity." }, { status: 400 });
  if (body?.sourceRefId !== undefined && (typeof body.sourceRefId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.sourceRefId))) return Response.json({ error: "Invalid hook." }, { status: 400 });
  try {
    const source = typeof body?.sourceRefId === "string" ? await getReference(body.sourceRefId, who) : null;
    if (body?.sourceRefId && !source) return Response.json({ error: "Hook not found." }, { status: 404 });
    return Response.json(await createRun(who, body?.id as string | undefined, source ?? undefined), { status: 201 });
  } catch {
    return Response.json({ error: "Couldn't create the video. Try again." }, { status: 503 });
  }
}
