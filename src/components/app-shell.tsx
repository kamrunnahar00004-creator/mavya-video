import { Suspense } from "react";
import Link from "next/link";
import { NavLinks } from "@/components/nav-links";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full gap-3 p-3">
      <aside className="card flex w-[212px] shrink-0 flex-col p-3">
        <Link href="/studio" className="flex items-center gap-2.5 px-2 py-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-[15px] font-black text-white">M</span>
          <span className="text-[18px] font-bold tracking-tight">Mavya</span>
        </Link>
        <nav className="mt-4 space-y-0.5">
          <Suspense fallback={<NavLinks />}>
            <NavLinks highlight />
          </Suspense>
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
