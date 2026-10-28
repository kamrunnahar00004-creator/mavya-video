"use client";

import NextLink, { useLinkStatus } from "next/link";
import { useEffect, useRef, type ComponentProps } from "react";

function Pending() {
  const { pending } = useLinkStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) window.dispatchEvent(new Event("mavya:navigation-end"));
    wasPending.current = pending;
  }, [pending]);
  return pending ? <span role="status" aria-label="Opening page" className="fixed inset-x-0 top-0 z-[100] h-1 animate-pulse bg-accent" /> : null;
}

/** Keep Next's partial shell prefetch. A loading boundary stops full editor prefetch. */
export default function Link({ children, onNavigate, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink {...props} onNavigate={event => {
    let prevented = false;
    onNavigate?.({ preventDefault() { prevented = true; event.preventDefault(); } });
    if (!prevented) window.dispatchEvent(new CustomEvent("mavya:navigate", { detail: String(props.href) }));
  }}>{children}<Pending /></NextLink>;
}
