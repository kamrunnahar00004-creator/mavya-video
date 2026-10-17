import type { Metadata } from "next";
import { Landing } from "@/components/landing";

export const metadata: Metadata = {
  title: "Mavya: AI made building easy. Mavya makes marketing easy.",
  description: "Pick a hook that already went viral, put an AI character in it, add your product demo.",
};

export default function Home() {
  return <Landing />;
}
