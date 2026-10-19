import { redirect } from "next/navigation";

/** Billing moved into Settings. */
export default function BillingPage() {
  redirect("/settings/billing");
}
