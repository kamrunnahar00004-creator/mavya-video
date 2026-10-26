import { listPage, pageResponse, listError } from "@/lib/server/list-pages";
import { connection } from "next/server";
import { currentUser, signInFirst } from "@/lib/server/who";

export async function GET(request: Request) {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  try { const page = await listPage("assets", who, request); return pageResponse(page.items, page.next); } catch (error) { return listError(error); }
}
