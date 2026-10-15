import { connection } from "next/server";
import { createRun, listRuns } from "@/lib/server/store";

export async function GET() {
  await connection();
  return Response.json(await listRuns());
}

export async function POST() {
  return Response.json(await createRun(), { status: 201 });
}
