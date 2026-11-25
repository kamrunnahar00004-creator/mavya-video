import "server-only";
import { currentUser, signInFirst } from "@/lib/server/who";

/** Content calendar's API guard: any signed-in account (founder 2026-11-26: "for all user's content calendar"). */
export async function postsUser(): Promise<{ who: string } | { response: Response }> {
  const who = await currentUser();
  if (!who) return { response: signInFirst() };
  return { who };
}

export const noStore = { "Cache-Control": "private, no-store" };
export const unavailable = (error: unknown) => {
  console.error("content calendar", error);
  const code = (error as { code?: string } | null)?.code;
  if (code === "PGRST205" || code === "42P01") return Response.json({ error: "Content calendar needs the database update supabase/migrations/0020_scheduled_posts.sql." }, { status: 503 });
  return Response.json({ error: "Content calendar is unavailable. Try again." }, { status: 503 });
};
