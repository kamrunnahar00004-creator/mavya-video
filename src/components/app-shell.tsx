import { NavigationFeedback } from "@/components/navigation-feedback";
import { Suspense } from "react";
import { MainNav, MobileBar, SidebarBody } from "@/components/sidebar-body";

/**
 * The signed-in app's frame. Desktop: the sidebar on the left. Phones (founder 2026-11-26, ads bring phone traffic):
 * a slim top bar with a menu button, so every page gets the full width.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-2 p-2 md:flex-row md:gap-3 md:p-3">
      <Suspense fallback={null}>
        <MobileBar />
      </Suspense>
      <aside className="card hidden w-[212px] shrink-0 flex-col p-3 md:flex">
        {/* The sidebar reads the URL (and ?plan= in Settings), so it renders inside a Suspense boundary. */}
        <Suspense fallback={<MainNav />}>
          <SidebarBody />
        </Suspense>
      </aside>
      <main className="relative min-h-0 min-w-0 flex-1"><div data-route-content className="h-full">{children}</div><Suspense fallback={null}><NavigationFeedback /></Suspense></main>
    </div>
  );
}
