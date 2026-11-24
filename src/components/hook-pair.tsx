"use client";

import { useEffect, useRef } from "react";

type Side = { src: string; poster: string; label: string; caption?: string };

/**
 * Landing hero: a viral hook and the same hook made in Mavya, side by side in one card, played in lockstep.
 * Both clips are the same length; when the original ends, both restart together so they never drift apart.
 * Plays only while on screen and the tab is visible; stays two still pictures for people who prefer reduced motion.
 */
export function HookPair({ before, after }: { before: Side; after: Side }) {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const va = a.current, vb = b.current;
    if (!va || !vb || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = false;
    const both = (fn: (v: HTMLVideoElement) => void) => { fn(va); fn(vb); };
    const live = () => visible && !document.hidden;
    // Attach both files on first view, then play only once both can, so a slower download does not put one behind.
    // Any later "canplay" (first load, or recovery after a stall) tries again, so nothing stays stuck paused.
    const start = () => {
      both((v) => { if (!v.getAttribute("src")) { v.preload = "auto"; v.src = v.dataset.src ?? ""; v.load(); } });
      if (va.readyState >= 3 && vb.readyState >= 3) both((v) => { if (v.paused) void v.play().catch(() => undefined); });
    };
    const onReady = () => { if (live()) start(); };
    // The original keeps the clock: if the copy drifts (a stall, a dropped frame), snap it back.
    const follow = () => { if (Math.abs(vb.currentTime - va.currentTime) > 0.12) vb.currentTime = va.currentTime; };
    const restart = () => both((v) => { v.currentTime = 0; });
    const onEnd = () => { restart(); if (live()) start(); };
    // Rewind only when it comes back into view, not on every threshold crossing while it stays visible.
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting;
      if (visible && !was && !document.hidden) { restart(); start(); }
      else if (!visible) both((v) => v.pause());
    }, { threshold: 0.33 });
    const hide = () => { if (document.hidden) both((v) => v.pause()); else if (visible) start(); };
    va.addEventListener("ended", onEnd);
    va.addEventListener("timeupdate", follow);
    both((v) => v.addEventListener("canplay", onReady));
    io.observe(va);
    document.addEventListener("visibilitychange", hide);
    return () => {
      va.removeEventListener("ended", onEnd);
      va.removeEventListener("timeupdate", follow);
      both((v) => v.removeEventListener("canplay", onReady));
      io.disconnect();
      document.removeEventListener("visibilitychange", hide);
      both((v) => v.pause());
    };
  }, []);
  return (
    <div data-hook-pair className="grid w-full max-w-[460px] grid-cols-2 gap-[2px] overflow-hidden border-2 border-ink bg-ink shadow-[6px_6px_0_var(--ink)]">
      {[{ side: before, ref: a }, { side: after, ref: b }].map(({ side, ref }, i) => (
        <figure key={side.src} className="relative aspect-[9/16] bg-black">
          <video ref={ref} data-src={side.src} poster={side.poster} muted playsInline preload="none" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          {side.caption && (
            <span className="absolute inset-x-2 top-[55%] text-center text-[12px] font-semibold leading-tight text-white [text-shadow:0_0_2px_#000,0_0_2px_#000,0_1px_3px_rgba(0,0,0,0.8)] sm:text-[14px]">{side.caption}</span>
          )}
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-3 pt-10 text-[12px] font-semibold text-white sm:text-[13px]">
            <span className={i === 1 ? "text-[#8fd0ff]" : "text-white/70"}>{i === 0 ? "Before" : "After"}</span>
            <span className="block text-white">{side.label}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
