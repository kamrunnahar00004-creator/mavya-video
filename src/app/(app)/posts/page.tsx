import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ScheduledPostsView } from "@/components/scheduled-posts-view";

export const metadata: Metadata = { title: "Content calendar · Mavya" };

/** Rendered per request: the calendar reads the clock (this week, today), so it is never prerendered at build time. */
async function Calendar() {
  await connection();
  return <ScheduledPostsView />;
}

/** Content calendar, for every signed-in account (founder 2026-11-26). */
export default function PostsPage() {
  return (
    <Suspense fallback={<div className="card h-full" />}>
      <Calendar />
    </Suspense>
  );
}
