"use client";

import NextLink, { useLinkStatus } from "next/link";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { flushSync } from "react-dom";

function Pending({ clicked, onEnd }: { clicked: boolean; onEnd: () => void }) {
  const { pending } = useLinkStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) {
      onEnd();
      window.dispatchEvent(new Event("mavya:navigation-end"));
    }
    wasPending.current = pending;
  }, [pending, onEnd]);
  useEffect(() => {
    if (!clicked) return;
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => { if (!wasPending.current) onEnd(); });
    });
    const timer = setTimeout(onEnd, 15_000);
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); clearTimeout(timer); };
  }, [clicked, onEnd]);
  return pending || clicked ? <span role="status" aria-label="Opening page" className="fixed inset-x-0 top-0 z-[100] h-1 animate-pulse bg-accent" /> : null;
}

/** Keep Next's partial shell prefetch. A loading boundary stops full editor prefetch. */
export default function Link({ children, onNavigate, ...props }: ComponentProps<typeof NextLink>) {
  const [clicked, setClicked] = useState(false);
  const end = useCallback(() => setClicked(false), []);
  return <NextLink {...props} onNavigate={event => {
    let prevented = false;
    onNavigate?.({ preventDefault() { prevented = true; event.preventDefault(); } });
    if (!prevented) {
      flushSync(() => setClicked(true));
      window.dispatchEvent(new CustomEvent("mavya:navigate", { detail: typeof props.href === "string" ? props.href : props.href.pathname ?? window.location.pathname }));
    }
  }}>{children}<Pending clicked={clicked} onEnd={end} /></NextLink>;
}
