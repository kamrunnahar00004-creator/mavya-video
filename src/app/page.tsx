import type { Metadata } from "next";
import { Landing } from "@/components/landing";

export const metadata: Metadata = {
  title: "Mavya: steal viral hooks, make 100 videos a day",
  description: "Pick a hook that already went viral, put an AI character in it, add your product demo. 10 hooks and 10 demos make 100 videos.",
};

export default function Home() {
  return <Landing />;
}
