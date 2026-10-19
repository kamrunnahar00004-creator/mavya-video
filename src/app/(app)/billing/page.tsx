import { Suspense } from "react";
import type { Metadata } from "next";
import { BillingView } from "@/components/billing-view";

export const metadata: Metadata = { title: "Billing · Mavya" };

/** BillingView reads `?plan=` (preview), so it renders inside a Suspense boundary. */
export default function BillingPage() {
  return (
    <Suspense fallback={<div className="card h-full" />}>
      <BillingView />
    </Suspense>
  );
}
