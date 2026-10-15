import { connection } from "next/server";
import { listAssets } from "@/lib/server/store";

export async function GET() {
  await connection();
  return Response.json(await listAssets());
}
