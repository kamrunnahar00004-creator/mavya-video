import { connection } from "next/server";
import { listAssets } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

export async function GET() {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  return Response.json(await listAssets(who));
}
