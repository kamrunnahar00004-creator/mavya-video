"use client";

import { useEffect, useRef, useState } from "react";

export type HookSide = { src: string; poster: string; label: string };
export type HookPairData = { before: HookSide; after: HookSide };

/** How many times a pair plays before the slideshow moves to the next one. */
export const PLAYS_PER_PAIR = 2;

/**
 * Landing hero: viral hooks next to the same hooks made in Mavya, one pair at a time, with square dots to pick one.
 * Each pair plays PLAYS_PER_PAIR times, then the next one shows. Picking a dot jumps to that pair and stops the
 * rotation, so the example someone chose stays put.
 */
export function HookSlides({ pairs }: { pairs: HookPairData[] }) {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(true);
  const pair = pairs[index];
  return (
    <div className="flex w-full max-w-[460px] flex-col items-center gap-5">
      <HookPair key={index} {...pair} onDone={() => { if (auto) setIndex((i) => (i + 1) % pairs.length); }} />
      <div className="flex gap-2.5" role="group" aria-label="Examples">
        {pairs.map((p, i) => (
          <button
            key={p.after.src}
            type="button"
            onClick={() => { setAuto(false); setIndex(i); }}
            aria-label={`Example ${i + 1}: ${p.before.label}`}
            aria-current={i === index}
            className={`h-3 w-3 border-2 border-ink transition-colors ${i === index ? "bg-accent" : "bg-panel hover:bg-line"}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A viral hook and the same hook made in Mavya, side by side in one card, played in lockstep.
 * Both clips are the same length; when the original ends, both restart together so they never drift apart.
 * Plays only while on screen and the tab is visible; stays two still pictures for people who prefer reduced motion.
 */
function HookPair({ before, after, onDone }: HookPairData & { onDone: () => void }) {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    const va = a.current, vb = b.current;
    if (!va || !vb || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = false;
    let plays = 0;
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
    const onEnd = () => {
      plays += 1;
      if (plays >= PLAYS_PER_PAIR) { done.current(); return; }
      restart();
      if (live()) start();
    };
    // Rewind only when it comes back into view, not on every threshold crossing while it stays visible.
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting;
      if (visible && !was && !document.hidden) { restart(); start(); }
      else if (!visible) both((v) => v.pause());
    }, { threshold: 0.33 });
    const hide = () => { if (document.hidden) both((v) => v.pause()); else if (visible) start(); };
    // A clip that fails to load must not strand the slideshow on a still picture: move on after a few seconds.
    let failed: ReturnType<typeof setTimeout> | undefined;
    const onError = () => { if (!failed) failed = setTimeout(() => done.current(), 4000); };
    va.addEventListener("ended", onEnd);
    both((v) => v.addEventListener("error", onError));
    va.addEventListener("timeupdate", follow);
    both((v) => v.addEventListener("canplay", onReady));
    io.observe(va);
    document.addEventListener("visibilitychange", hide);
    return () => {
      va.removeEventListener("ended", onEnd);
      both((v) => v.removeEventListener("error", onError));
      clearTimeout(failed);
      va.removeEventListener("timeupdate", follow);
      both((v) => v.removeEventListener("canplay", onReady));
      io.disconnect();
      document.removeEventListener("visibilitychange", hide);
      both((v) => v.pause());
    };
  }, []);
  return (
    <div data-hook-pair className="grid w-full grid-cols-2 gap-[2px] overflow-hidden border-2 border-ink bg-ink shadow-[6px_6px_0_var(--ink)]">
      {[{ side: before, ref: a }, { side: after, ref: b }].map(({ side, ref }, i) => (
        <figure key={side.src} className="relative aspect-[9/16] bg-black">
          <video ref={ref} data-src={side.src} poster={side.poster} muted playsInline preload="none" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-3 pt-10 text-[12px] font-semibold text-white sm:text-[13px]">
            <span className={i === 1 ? "text-[#8fd0ff]" : "text-white/70"}>{i === 0 ? "Before" : "After"}</span>
            <span className="block text-white">{side.label}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
