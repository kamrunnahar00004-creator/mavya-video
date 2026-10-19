import type { Metadata } from "next";
import { ProfileView } from "@/components/profile-view";

export const metadata: Metadata = { title: "Settings · Mavya" };

export default function SettingsPage() {
  return <ProfileView />;
}
