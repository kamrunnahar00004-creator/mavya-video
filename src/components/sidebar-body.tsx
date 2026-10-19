"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountChip } from "@/components/account-chip";
import { MavyaMark } from "@/components/marketing-chrome";
import { NavLinks } from "@/components/nav-links";
import { SettingsNav } from "@/components/settings-shell";

/** The app sidebar: the main nav, or the settings nav while in Settings. */
export function SidebarBody() {
  return usePathname()?.startsWith("/settings") ? <SettingsNav /> : <MainNav highlight />;
}

export function MainNav({ highlight }: { highlight?: boolean }) {
  return (
    <>
      <Link href="/studio" className="flex items-center gap-2.5 px-2 py-2">
        <MavyaMark />
        <span className="text-[18px] font-bold tracking-tight">Mavya</span>
      </Link>
      <nav className="mt-4 space-y-0.5">
        <NavLinks highlight={highlight} />
      </nav>
      <div className="mt-auto border-t border-line pt-2">
        <AccountChip />
      </div>
    </>
  );
}
