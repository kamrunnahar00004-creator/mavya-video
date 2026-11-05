import { readResponse } from "@/lib/server/read-timing";
import { connection } from "next/server";
import { getFilePrefs, changeFilePrefs } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

/** My files: the seller's names for items and the items removed from the list (see FilePrefs). */
export async function GET() {
  return readResponse(() => readGET());
}

async function readGET() {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  try { return Response.json(await getFilePrefs(who)); }
  catch { return Response.json({ error: "My files is unavailable. Try again." }, { status: 503 }); }
}

/** One change: { key, name } renames (empty name = back to the default), { key, hidden: true } removes from the list.
 *  { keys: [...], hidden: true } removes several at once (multi-select Delete), up to 500. */
export async function PATCH(request: Request) {
  const who = await currentUser();
  if (!who) return signInFirst();
  const body = (await request.json().catch(() => null)) as { key?: unknown; keys?: unknown; name?: unknown; hidden?: unknown } | null;
  const okKey = (k: unknown): k is string => typeof k === "string" && !!k && k.length <= 600;
  const key = Array.isArray(body?.keys) ? body.keys : body?.key;
  if (Array.isArray(key) ? !key.length || key.length > 500 || !key.every(okKey) || body?.name !== undefined : !okKey(key)) return Response.json({ error: "Bad request" }, { status: 400 });
  if (body?.name !== undefined && typeof body.name !== "string") return Response.json({ error: "Bad request" }, { status: 400 });
  if (body?.hidden !== undefined && typeof body.hidden !== "boolean") return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    const prefs = await changeFilePrefs(who, key as string | string[], {
      ...(typeof body?.name === "string" ? { name: body.name } : {}),
      ...(typeof body?.hidden === "boolean" ? { hidden: body.hidden } : {}),
    });
    return Response.json(prefs);
  } catch {
    return Response.json({ error: "Couldn't save. Try again." }, { status: 503 });
  }
}
