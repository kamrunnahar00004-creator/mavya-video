import { Suspense } from "react";
import type { Metadata } from "next";
import { BillingView } from "@/components/billing-view";

export const metadata: Metadata = { title: "Billing · Mavya" };

/** Reads `?paid=` (back from Checkout), so it renders inside a Suspense boundary. */
export default function Page() {
  return (
    <Suspense fallback={<div className="card h-full" />}>
      <BillingView />
    </Suspense>
  );
}
