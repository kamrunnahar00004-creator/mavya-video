import { connection } from "next/server";
import { listExports } from "@/lib/server/scheduled-posts";
import { noStore, postsUser, unavailable } from "@/lib/server/posts-route";

/** The exported videos to schedule, newest first. */
export async function GET() {
  await connection();
  const user = await postsUser();
  if ("response" in user) return user.response;
  try { return Response.json({ exports: await listExports(user.who) }, { headers: noStore }); }
  catch (error) { return unavailable(error); }
}
