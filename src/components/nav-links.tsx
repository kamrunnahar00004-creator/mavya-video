"use client";

import Link from "@/components/pending-link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, Clapperboard, Settings } from "lucide-react";

/**
 * The sidebar's items, for every account. No Viral library (founder 2026-11-26): it duplicated "Browse hooks" inside a
 * video; the page stays at /library so old links still work.
 */
export const NAV = [
  { href: "/studio", label: "Videos", icon: Clapperboard },
  { href: "/guides", label: "Guides", icon: BookOpen },
  { href: "/posts", label: "Content calendar", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Links({ pathname }: { pathname: string | null }) {
  return NAV.map(({ href, label, icon: Icon }) => {
    const on = pathname?.startsWith(href) ?? false;
    return (
      <Link
        key={href}
        href={href}
        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-semibold ${on ? "bg-raised text-text" : "text-muted hover:bg-raised hover:text-text"}`}
      >
        <Icon className="h-[17px] w-[17px]" strokeWidth={on ? 2.3 : 2} />
        {label}
      </Link>
    );
  });
}

function HighlightedLinks() {
  return <Links pathname={usePathname()} />;
}

/** The active highlight reads the URL, so it renders inside a Suspense boundary. */
export function NavLinks({ highlight }: { highlight?: boolean }) {
  return highlight ? <HighlightedLinks /> : <Links pathname={null} />;
}
