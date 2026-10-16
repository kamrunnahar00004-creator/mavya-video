import { AppShell } from "@/components/app-shell";

/** The signed-in app (videos, library, billing) sits in the sidebar shell; the landing page does not. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
