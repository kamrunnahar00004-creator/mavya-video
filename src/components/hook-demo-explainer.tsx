"use client";

import { useEffect, useRef, useState } from "react";
import { Film } from "lucide-react";

const clock = (s: number) => `0:${String(Math.floor(s)).padStart(2, "0")}`;

/**
 * Landing: what a hook + demo video is, shown with a real one. The video plays on a loop (only while on screen);
 * the Hook | Demo timeline, its playhead and the two labels follow the video's own clock.
 */
export function HookDemoExplainer({ src, poster, hookEnd, length }: { src: string; poster: string; hookEnd: number; length: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const tick = () => {
      setT(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const seen = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting && !reduced) {
        if (!v.getAttribute("src")) v.src = src;
        void v.play().catch(() => undefined);
        raf = requestAnimationFrame(tick);
      } else v.pause();
    }, { threshold: 0.3 });
    seen.observe(v);
    return () => { seen.disconnect(); cancelAnimationFrame(raf); };
  }, [src]);
  const inHook = t < hookEnd;
  const card = (on: boolean) => `flex gap-4 rounded-2xl border p-4 transition-[opacity,border-color] duration-300 ${on ? "border-ink opacity-100" : "border-line opacity-55"}`;
  return (
    <div className="grid items-center gap-10 rounded-3xl border border-line bg-panel p-6 sm:p-10 lg:grid-cols-[auto_1fr]">
      <div className="mx-auto w-[240px]">
        <div className="rounded-[34px] bg-ink p-[6px] shadow-[0_30px_60px_-24px_rgba(21,18,31,0.55)]">
          <video ref={ref} poster={poster} muted loop playsInline preload="none" aria-label="A hook + demo video" className="aspect-[9/16] w-full rounded-[28px] bg-[#14121f] object-cover" />
        </div>
        <div className="relative mt-4 flex h-7 overflow-hidden rounded-md text-[10.5px] font-bold">
          <span className="flex min-w-[54px] items-center gap-1 bg-[#221d33] px-2 text-white" style={{ width: `${(hookEnd / length) * 100}%` }}><Film className="h-3 w-3 shrink-0" />Hook</span>
          <span className="flex flex-1 items-center gap-1 border-l-2 border-panel bg-[#d2d0df] px-2 text-text"><Film className="h-3 w-3" />Demo</span>
          <span className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${Math.min(100, (t / length) * 100)}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] font-semibold tabular-nums text-soft">
          <span>0:00</span>
          <span>{clock(length)}</span>
        </div>
      </div>
      <div>
        <h2 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[42px]">What is a hook + demo video?</h2>
        <p className="mt-3 max-w-[520px] text-[16.5px] leading-relaxed text-muted">The short video SaaS founders post to get signups without ads. It works for any SaaS, app or online tool, because the product sells itself on screen. Two parts:</p>
        <div className="mt-7 space-y-3">
          <div className={card(inHook)}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-text text-[14px] font-semibold text-white">1</span>
            <div>
              <div className="flex items-baseline gap-2"><h3 className="text-[18px] font-semibold">The hook</h3><span className="text-[12.5px] font-semibold tabular-nums text-soft">the first {Math.round(hookEnd)} seconds</span></div>
              <p className="mt-0.5 text-[14.5px] leading-snug text-muted">A face and one line that stop the scroll. Copied from a video that already went viral, with an AI character in it.</p>
              <span className="mt-2 inline-block rounded-full bg-accent-tint px-2.5 py-0.5 text-[12px] font-bold text-accent">Mavya makes this</span>
            </div>
          </div>
          <div className={card(!inHook)}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-[14px] font-semibold text-text">2</span>
            <div>
              <div className="flex items-baseline gap-2"><h3 className="text-[18px] font-semibold">The demo</h3><span className="text-[12.5px] font-semibold tabular-nums text-soft">to the end</span></div>
              <p className="mt-0.5 text-[14.5px] leading-snug text-muted">Your SaaS or app doing the thing it promised: a screen recording, or your phone filming the screen.</p>
              <span className="mt-2 inline-block rounded-full bg-raised px-2.5 py-0.5 text-[12px] font-bold text-muted">You add this</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
