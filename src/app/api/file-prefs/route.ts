import { connection } from "next/server";
import { getFilePrefs, setFilePrefs } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

/** My files: the seller's names for items and the items removed from the list (see FilePrefs). */
export async function GET() {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  try { return Response.json(await getFilePrefs(who)); }
  catch { return Response.json({ error: "My files is unavailable. Try again." }, { status: 503 }); }
}

/** One change: { key, name } renames (empty name = back to the default), { key, hidden: true } removes from the list. */
export async function PATCH(request: Request) {
  const who = await currentUser();
  if (!who) return signInFirst();
  const body = (await request.json().catch(() => null)) as { key?: unknown; name?: unknown; hidden?: unknown } | null;
  const key = body?.key;
  if (typeof key !== "string" || !key || key.length > 600) return Response.json({ error: "Bad request" }, { status: 400 });
  if (body?.name !== undefined && typeof body.name !== "string") return Response.json({ error: "Bad request" }, { status: 400 });
  if (body?.hidden !== undefined && typeof body.hidden !== "boolean") return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    const prefs = await getFilePrefs(who);
    if (typeof body?.name === "string") {
      const name = body.name.trim().slice(0, 80);
      if (name) prefs.names[key] = name;
      else delete prefs.names[key];
    }
    if (body?.hidden === true && !prefs.hidden.includes(key)) prefs.hidden = [...prefs.hidden, key].slice(-5000);
    if (body?.hidden === false) prefs.hidden = prefs.hidden.filter((k) => k !== key);
    const names = Object.entries(prefs.names);
    if (names.length > 5000) prefs.names = Object.fromEntries(names.slice(-5000));
    await setFilePrefs(who, prefs);
    return Response.json(prefs);
  } catch {
    return Response.json({ error: "Couldn't save. Try again." }, { status: 503 });
  }
}
