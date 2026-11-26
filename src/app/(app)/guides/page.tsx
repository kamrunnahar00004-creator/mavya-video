import type { Metadata } from "next";
import { GuidesView } from "@/components/guides-view";

export const metadata: Metadata = { title: "Guides · Mavya" };

/** How to use Mavya, step by step with screenshots (founder 2026-11-26). */
export default function GuidesPage() {
  return <GuidesView />;
}
