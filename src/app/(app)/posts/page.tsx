import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/server/who";
import { schedulerAllowed } from "@/lib/server/scheduled-posts";
import { ScheduledPostsView } from "@/components/scheduled-posts-view";

export const metadata: Metadata = { title: "Scheduled posts · Mavya" };

/** Owner-only for now (SCHEDULED_POSTS_USERS); everyone else gets the 404 page. */
async function OwnerOnly() {
  await connection();
  if (!schedulerAllowed(await currentUser())) notFound();
  return <ScheduledPostsView />;
}

export default function PostsPage() {
  return (
    <Suspense fallback={<div className="card h-full" />}>
      <OwnerOnly />
    </Suspense>
  );
}
