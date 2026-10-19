import { Suspense } from "react";
import { MainNav, SidebarBody } from "@/components/sidebar-body";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full gap-3 p-3">
      <aside className="card flex w-[212px] shrink-0 flex-col p-3">
        {/* The sidebar reads the URL (and ?plan= in Settings), so it renders inside a Suspense boundary. */}
        <Suspense fallback={<MainNav />}>
          <SidebarBody />
        </Suspense>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
