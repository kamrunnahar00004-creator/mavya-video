"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { RouteSkeleton } from "@/components/route-skeleton";

/** Client feedback precedes the proxy, so even an unprefetched 250 ms round trip is visible. */
export function NavigationFeedback() {
  const pathname = usePathname();
  const [target, setTarget] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    const navigate = (event: Event) => {
      const url = new URL((event as CustomEvent<string>).detail, window.location.href);
      if (url.origin === window.location.origin && url.pathname !== pathname) setTarget({ from: pathname, to: url.pathname });
    };
    const end = () => setTarget(null);
    window.addEventListener("mavya:navigate", navigate);
    window.addEventListener("mavya:navigation-end", end);
    return () => {
      window.removeEventListener("mavya:navigate", navigate);
      window.removeEventListener("mavya:navigation-end", end);
    };
  }, [pathname]);
  useEffect(() => { queueMicrotask(() => setTarget(null)); }, [pathname]);
  return target && target.from === pathname ? <div className="absolute inset-0 z-40" data-navigation-pending><RouteSkeleton path={target.to} /></div> : null;
}
