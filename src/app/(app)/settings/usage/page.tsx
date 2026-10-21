import { Suspense } from "react";
import type { Metadata } from "next";
import { UsageView } from "@/components/usage-view";

export const metadata: Metadata = { title: "Usage · Mavya" };

export default function Page() {
  return (
    <Suspense fallback={<div className="card h-full" />}>
      <UsageView />
    </Suspense>
  );
}
