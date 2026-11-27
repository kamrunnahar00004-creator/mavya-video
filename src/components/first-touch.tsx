"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SOURCE_COOKIE, SOURCE_DAYS, sourceFromSearch, writeSource } from "@/lib/first-touch";

/**
 * Keeps the ad's codes from the first tagged visit (src/lib/first-touch.ts) so the account remembers where it came
 * from. Never overwrites an earlier one; does nothing on a visit without codes.
 */
export function FirstTouch() {
  const pathname = usePathname();
  const query = useSearchParams().toString(); // codes added without a page change count too (Codex)
  useEffect(() => {
    try {
      if (document.cookie.split("; ").some((c) => c.startsWith(`${SOURCE_COOKIE}=`))) return;
      const s = sourceFromSearch(window.location.search, new Date());
      if (!s) return;
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${SOURCE_COOKIE}=${writeSource(s)}; Max-Age=${SOURCE_DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
    } catch {}
  }, [pathname, query]);
  return null;
}
