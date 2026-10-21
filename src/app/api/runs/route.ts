import { connection } from "next/server";
import { createRun, listRuns } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

export async function GET() {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  return Response.json(await listRuns(who));
}

export async function POST() {
  const who = await currentUser();
  if (!who) return signInFirst();
  return Response.json(await createRun(who), { status: 201 });
}
