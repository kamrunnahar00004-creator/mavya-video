import "server-only";
import { currentUser, signInFirst } from "@/lib/server/who";
import { schedulerAllowed } from "@/lib/server/scheduled-posts";

/** Scheduled posts' API guard: signed in, and on the owner list. Anyone else gets 404, as if it didn't exist. */
export async function postsUser(): Promise<{ who: string } | { response: Response }> {
  const who = await currentUser();
  if (!who) return { response: signInFirst() };
  if (!schedulerAllowed(who)) return { response: Response.json({ error: "Not found" }, { status: 404 }) };
  return { who };
}

export const noStore = { "Cache-Control": "private, no-store" };
export const unavailable = (error: unknown) => {
  console.error("scheduled posts", error);
  const code = (error as { code?: string } | null)?.code;
  if (code === "PGRST205" || code === "42P01") return Response.json({ error: "Scheduled posts need the database update supabase/migrations/0020_scheduled_posts.sql." }, { status: 503 });
  return Response.json({ error: "Scheduled posts are unavailable. Try again." }, { status: 503 });
};
