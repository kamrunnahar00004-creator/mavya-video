import { connection } from "next/server";
import { currentUser } from "@/lib/server/who";
import { schedulerAllowed } from "@/lib/server/scheduled-posts";

/** Whether the sidebar shows Scheduled posts (owner-only for now). */
export async function GET() {
  await connection();
  return Response.json({ allowed: schedulerAllowed(await currentUser()) }, { headers: { "Cache-Control": "private, no-store" } });
}
