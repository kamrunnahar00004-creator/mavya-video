import { readResponse } from "@/lib/server/read-timing";
import { connection } from "next/server";
import { fileSources } from "@/lib/server/my-files";
import { currentUser, signInFirst } from "@/lib/server/who";

/** My files: everything it lists, in one read (src/lib/server/my-files.ts). */
export async function GET() {
  return readResponse(() => readGET());
}

async function readGET() {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  try { return Response.json(await fileSources(who), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { console.error("my files", error); return Response.json({ error: "My files is unavailable. Try again." }, { status: 503 }); }
}
