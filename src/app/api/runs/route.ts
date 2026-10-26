import { listPage, pageResponse, listError } from "@/lib/server/list-pages";
import { connection } from "next/server";
import { createRun } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

export async function GET(request: Request) {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  try { const page = await listPage("runs", who, request); return pageResponse(page.items, page.next); } catch (error) { return listError(error); }
}

export async function POST() {
  const who = await currentUser();
  if (!who) return signInFirst();
  return Response.json(await createRun(who), { status: 201 });
}
