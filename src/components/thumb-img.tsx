"use client";
import { useEffect, useRef, useState } from "react";
import { thumbOf } from "@/lib/thumb";

/**
 * A list's still picture of a stored video (thumbOf), never a video (founder 2026-11-09). A picture not made yet (a big
 * clip waiting for its light copy) is tried again after 5 s and 20 s; then a plain tile. A new `src` starts afresh.
 */
export function ThumbImg({ src, className }: { src: string; className?: string }) {
  const [state, setState] = useState({ src, tries: 0 });
  const tries = state.src === src ? state.tries : 0;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A retry waiting for another clip's picture is dropped.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, [src]);
  const thumb = thumbOf(src);
  if (tries > 2 || !thumb) return <span className={`bg-raised ${className ?? ""}`} />;
  const retry = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState({ src, tries: tries + 1 }), tries ? 20_000 : 5_000);
  };
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={`${src}|${tries}`} src={tries ? `${thumb}?try=${tries}` : thumb} alt="" loading="lazy" decoding="async" onError={retry} className={className} />;
}
