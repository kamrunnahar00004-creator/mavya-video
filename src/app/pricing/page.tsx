import type { Metadata } from "next";
import { PricingPage } from "@/components/pricing-page";

export const metadata: Metadata = {
  title: "Pricing · Mavya",
  description: "Hooks, scripts, AI creators, editing and music in one tool, for less than a quarter of what the separate tools cost.",
};

export default function Pricing() {
  return <PricingPage />;
}
