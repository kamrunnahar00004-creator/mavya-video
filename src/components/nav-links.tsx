"use client";

import Link from "@/components/pending-link";
import { usePathname } from "next/navigation";
import { usePostsNav } from "@/lib/posts-nav";
import { CalendarClock, Clapperboard, Flame, Settings } from "lucide-react";

const NAV = [
  { href: "/studio", label: "Videos", icon: Clapperboard },
  { href: "/library", label: "Viral library", icon: Flame },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Scheduled posts sits under Viral library, for the accounts the server allows (owner-only for now). */
const POSTS = { href: "/posts", label: "Scheduled posts", icon: CalendarClock };

/** The sidebar's items: Scheduled posts right under Viral library, only when the server allows this account. */
export const navItems = (posts: boolean) => (posts ? [NAV[0], NAV[1], POSTS, ...NAV.slice(2)] : NAV);

function Links({ pathname }: { pathname: string | null }) {
  return navItems(usePostsNav()).map(({ href, label, icon: Icon }) => {
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
