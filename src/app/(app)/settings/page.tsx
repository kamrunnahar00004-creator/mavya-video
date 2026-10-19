import { Suspense } from "react";
import type { Metadata } from "next";
import { ProfileView } from "@/components/profile-view";

export const metadata: Metadata = { title: "Profile · Mavya" };

/** The settings layout reads `?plan=` (preview), so the page renders inside a Suspense boundary. */
export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="card h-full" />}>
      <ProfileView />
    </Suspense>
  );
}
