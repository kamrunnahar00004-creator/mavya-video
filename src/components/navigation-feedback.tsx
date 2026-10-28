"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { usePathname } from "next/navigation";
import { RouteSkeleton } from "@/components/route-skeleton";

/** Client feedback precedes the proxy, so even an unprefetched 250 ms round trip is visible. */
export function NavigationFeedback() {
  const pathname = usePathname();
  const [target, setTarget] = useState<{ from: string; to: string } | null>(null);
  const [expired, setExpired] = useState<typeof target>(null);
  useEffect(() => {
    const navigate = (event: Event) => {
      const url = new URL((event as CustomEvent<string>).detail, window.location.href);
      if (url.origin === window.location.origin && url.pathname !== pathname) flushSync(() => setTarget({ from: pathname, to: url.pathname }));
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
  useLayoutEffect(() => {
    if (!target || target.from !== pathname) return;
    const content = document.querySelector<HTMLElement>("[data-route-content]");
    if (!content) return;
    const wasInert = content.inert, wasVisibility = content.style.contentVisibility;
    content.inert = true;
    // The opaque destination covers this page. Skip its grid layout/paint while waiting.
    content.style.contentVisibility = "hidden";
    return () => { content.inert = wasInert; content.style.contentVisibility = wasVisibility; };
  }, [target, pathname]);
  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => setExpired(target), 15_000);
    return () => clearTimeout(timer);
  }, [target]);
  if (target && target.from === pathname && expired === target) return <div role="alert" className="card absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-panel">
    <p>Couldn&apos;t open the page.</p><a href={target.to} className="btn-primary px-4 py-2">Try again</a>
  </div>;
  return target && target.from === pathname ? <div className="absolute inset-0 z-40" data-navigation-pending><RouteSkeleton path={target.to} /></div> : null;
}
