import { Suspense } from "react";
import type { Metadata } from "next";
import { PlansView } from "@/components/plans-view";

export const metadata: Metadata = { title: "Plans · Mavya" };

/** Reads `?plan=` (preview), so it renders inside a Suspense boundary. */
export default function Page() {
  return (
    <Suspense fallback={<div className="card h-full" />}>
      <PlansView />
    </Suspense>
  );
}
