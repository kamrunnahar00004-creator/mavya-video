import { Suspense } from "react";
import type { Metadata } from "next";
import { PlansView } from "@/components/plans-view";

export const metadata: Metadata = { title: "Plans · Mavya" };

export default function Page() {
  return (
    <Suspense fallback={<div className="card h-full" />}>
      <PlansView />
    </Suspense>
  );
}
