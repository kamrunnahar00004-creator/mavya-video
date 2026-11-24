import type { Metadata } from "next";
import { Landing } from "@/components/landing";

export const metadata: Metadata = {
  title: "Mavya: turn your app demo into a viral reel",
  description: "Pick a hook that already went viral, put an AI character in it, add your product demo.",
};

export default function Home() {
  return <Landing />;
}
