"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Landing: a short muted loop that costs nothing until it is needed. Shows the poster first, starts loading only
 * when it comes near the screen, plays only while on screen, pauses when scrolled away or when the tab is hidden,
 * and stays a still picture for people who prefer reduced motion.
 */
export function LoopVideo({ src, poster, className = "" }: { src: string; poster: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const visible = useRef(false);
  // The file is attached after it first comes near: start it then if it is already on screen.
  useEffect(() => {
    if (near && visible.current && !document.hidden) void ref.current?.play().catch(() => undefined);
  }, [near]);
  useEffect(() => {
    const v = ref.current;
    if (!v || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Start loading a little before it shows.
    const load = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); load.disconnect(); } }, { rootMargin: "300px" });
    // Play only while at least a third of it is visible.
    const play = new IntersectionObserver(([e]) => {
      visible.current = e.isIntersecting;
      if (e.isIntersecting && !document.hidden) void v.play().catch(() => undefined);
      else v.pause();
    }, { threshold: 0.33 });
    const hide = () => { if (document.hidden) v.pause(); };
    load.observe(v);
    play.observe(v);
    document.addEventListener("visibilitychange", hide);
    return () => { load.disconnect(); play.disconnect(); document.removeEventListener("visibilitychange", hide); };
  }, []);
  return (
    <video
      ref={ref}
      src={near ? src : undefined}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
      className={className}
    />
  );
}
