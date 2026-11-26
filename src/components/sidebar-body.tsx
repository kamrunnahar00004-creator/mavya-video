"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/pending-link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
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

/**
 * Phones only (md:hidden): the logo and a menu button; the menu opens the same sidebar as a drawer. It closes when the
 * page changes, on the backdrop, the close button or Escape.
 */
export function MobileBar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [shownFor, setShownFor] = useState(pathname);
  // A new page closes the menu (state adjusted during render, not in an effect).
  if (shownFor !== pathname) { setShownFor(pathname); setOpen(false); }
  // While open, the page behind is inert (no focus, no clicks, hidden from screen readers) and focus starts inside the
  // menu; closing hands focus back to the menu button (Codex 2026-11-26).
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const behind = [document.querySelector("main"), menuButton.current?.closest("header")].filter((x): x is HTMLElement => Boolean(x));
    for (const el of behind) el.inert = true;
    closeButton.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    // Rotated or resized to desktop width while open: close, so nothing stays inert behind a hidden drawer (Codex).
    const desktop = window.matchMedia("(min-width: 48rem)");
    const wide = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", wide);
    const trigger = menuButton.current;
    return () => { window.removeEventListener("keydown", key); desktop.removeEventListener("change", wide); for (const el of behind) el.inert = false; trigger?.focus(); };
  }, [open]);
  return (
    <>
      <header className="card flex shrink-0 items-center justify-between px-3 py-2 md:hidden">
        <Link href="/studio" className="flex items-center gap-2">
          <MavyaMark />
          <span className="text-[17px] font-bold tracking-tight">Mavya</span>
        </Link>
        <button ref={menuButton} type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(true)} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-text hover:bg-raised">
          <Menu className="h-5 w-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-[#1c2633]/50" />
          <div className="card absolute inset-y-2 left-2 flex w-[260px] max-w-[calc(100vw-16px)] flex-col p-3">
            <button ref={closeButton} type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-2 top-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-soft hover:bg-raised hover:text-text"><X className="h-5 w-5" /></button>
            <SidebarBody />
          </div>
        </div>
      )}
    </>
  );
}
