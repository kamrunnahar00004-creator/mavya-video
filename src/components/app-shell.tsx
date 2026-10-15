import { Suspense } from "react";
import Link from "next/link";
import { Lock, Type, UserRound } from "lucide-react";
import { NavLinks } from "@/components/nav-links";

const SOON = [
  { label: "Text on Screen", icon: Type },
  { label: "Avatars", icon: UserRound },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full gap-3 p-3">
      <aside className="card flex w-[228px] shrink-0 flex-col p-3">
        <Link href="/studio" className="flex items-center gap-2.5 px-2 py-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-ink bg-accent text-[15px] font-black text-white shadow-[2px_2px_0_var(--ink)]">M</span>
          <span className="text-[18px] font-bold tracking-tight">Mavya</span>
        </Link>

        <div className="mt-5 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-soft">Create</div>
        <nav className="mt-1.5 space-y-0.5">
          <Suspense fallback={<NavLinks />}>
            <NavLinks highlight />
          </Suspense>
          {SOON.map(({ label, icon: Icon }) => (
            <div key={label} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-semibold text-soft">
              <Icon className="h-[17px] w-[17px]" />
              {label}
              <Lock className="ml-auto h-3.5 w-3.5" />
            </div>
          ))}
        </nav>

        <div className="mt-auto rounded-xl bg-raised p-3">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Local mode
          </div>
          <div className="mt-1 text-[12px] text-muted">Saved on this computer</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
