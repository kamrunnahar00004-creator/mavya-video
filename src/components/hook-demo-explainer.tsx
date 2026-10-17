"use client";

import { useEffect, useRef, useState } from "react";

const clock = (s: number) => `0:${String(Math.floor(s)).padStart(2, "0")}`;
const LIGHT_VIOLET = "#b69cff";

/**
 * Landing: what a hook + demo video is, shown with a real one, on a dark surface so the videos carry the colour.
 * A real phone plays it on a loop (only while on screen); under it, the video's own frames as a timeline with the
 * hook part outlined and a playhead on the video's clock. Beside it, the definition and the volume idea as a matrix
 * of real hooks x real demos that fills in once when it scrolls into view.
 */
export function HookDemoExplainer({ src, poster, strip, hookEnd, length }: { src: string; poster: string; /** Frames across the video, side by side in one image. */ strip: string; hookEnd: number; length: number }) {
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
  const hookPct = (hookEnd / length) * 100;
  const inHook = t < hookEnd;
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-[#15121f] text-white">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[640px] w-[640px] rounded-full bg-[radial-gradient(closest-side,rgba(123,76,250,0.38),transparent)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 right-0 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(176,47,134,0.2),transparent)]" />
      <div className="relative grid items-center gap-14 px-6 py-14 sm:px-12 sm:py-16 lg:grid-cols-[auto_1fr] lg:gap-20 lg:px-16 lg:py-20">
        <div className="mx-auto w-[250px]">
          <div className="relative rounded-[38px] bg-[#0b0910] p-[7px] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
            <div className="relative aspect-[9/19.5] overflow-hidden rounded-[31px] bg-black">
              <video ref={ref} poster={poster} muted loop playsInline preload="none" aria-label="A hook + demo video" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute left-1/2 top-2.5 h-[18px] w-[72px] -translate-x-1/2 rounded-full bg-black" />
              <span className={`absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-bold text-white transition-colors duration-300 ${inHook ? "bg-accent" : "bg-black/60"}`}>{inHook ? "Hook" : "Demo"}</span>
            </div>
          </div>
          <div className="relative mt-6">
            <div className="relative h-[60px] overflow-hidden rounded-lg ring-1 ring-white/10" style={{ backgroundImage: `url(${strip})`, backgroundSize: "100% 100%" }}>
              <span className="absolute inset-y-0 right-0 bg-black/45" style={{ left: `${hookPct}%` }} />
              <span className="absolute inset-y-0 left-0 rounded-l-lg ring-[3px] ring-inset ring-accent" style={{ width: `${hookPct}%` }} />
              <span className="absolute -inset-y-1 w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.6)]" style={{ left: `${Math.min(100, (t / length) * 100)}%` }} />
            </div>
            <div className="mt-2 flex text-[11.5px] font-bold">
              <span style={{ width: `${hookPct}%`, color: LIGHT_VIOLET }}>Hook</span>
              <span className="text-white/60">Demo</span>
              <span className="ml-auto font-semibold tabular-nums text-white/40">{clock(length)}</span>
            </div>
          </div>
        </div>

        <div className="max-w-[600px]">
          <h2 className="text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-white! sm:text-[40px] xl:text-[42px]">
            What’s a <span className="whitespace-nowrap">hook + demo</span> video?
          </h2>
          <p className="mt-5 text-[18px] leading-relaxed text-white/70 sm:text-[19px]">
            A scroll-stopping face <span className="font-semibold" style={{ color: LIGHT_VIOLET }}>(the hook)</span> followed by your product in action <span className="font-semibold" style={{ color: LIGHT_VIOLET }}>(the demo)</span>.
          </p>
          <div className="mt-12 border-t border-white/10 pt-10">
            <h3 className="text-[20px] font-semibold text-white!">The game is volume.</h3>
            <VolumeMatrix />
            <p className="mt-7 text-[18px] leading-relaxed text-white/70">More videos, more shots at going viral.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * 10 hooks x 10 demos = 100 videos, kept simple: a fanned hand of three real hook cards, times a fanned hand of
 * three real demo cards, equals a big 100. The hands fan out once when they scroll into view (already fanned
 * under reduced motion).
 */
const MX_HOOKS = [0, 1, 3].map((i) => `/landing/mx-hook-${i}.jpg`);
const MX_DEMOS = [0, 1, 3].map((i) => `/landing/mx-demo-${i}.jpg`);
const FAN = [
  { rotate: -9, x: -26, y: 6 },
  { rotate: 0, x: 0, y: 0 },
  { rotate: 9, x: 26, y: 6 },
];

function Hand({ cards, label, on }: { cards: string[]; label: string; on: boolean }) {
  return (
    <figure className="flex flex-col items-center">
      <div className="relative h-[124px] w-[124px] sm:h-[136px] sm:w-[136px]">
        {cards.map((src, i) => (
          <span
            key={src}
            className="absolute left-1/2 top-0 h-[116px] w-[66px] overflow-hidden rounded-[10px] bg-white/5 bg-cover bg-center shadow-[0_14px_30px_-12px_rgba(0,0,0,0.8)] ring-1 ring-white/20 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:h-[128px] sm:w-[72px]"
            style={{
              backgroundImage: `url(${src})`,
              zIndex: i === 1 ? 2 : 1,
              transform: on ? `translateX(calc(-50% + ${FAN[i].x}px)) translateY(${FAN[i].y}px) rotate(${FAN[i].rotate}deg)` : "translateX(-50%)",
              transitionDelay: `${i * 70}ms`,
            }}
          />
        ))}
      </div>
      <figcaption className="mt-3 text-[14px] font-semibold text-white/75">{label}</figcaption>
    </figure>
  );
}

function VolumeMatrix() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setOn(true);
        io.disconnect();
      }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const op = "pb-7 text-[30px] font-light text-white/35";
  return (
    <div ref={ref} className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-6 sm:gap-x-8">
      <Hand cards={MX_HOOKS} label="10 hooks" on={on} />
      <span className={op}>×</span>
      <Hand cards={MX_DEMOS} label="10 demos" on={on} />
      <span className={op}>=</span>
      <figure className="flex flex-col items-center pb-1">
        <div className="text-[72px] font-semibold leading-none tracking-[-0.045em] sm:text-[84px]" style={{ color: LIGHT_VIOLET }}>100</div>
        <figcaption className="mt-3 text-[14px] font-semibold text-white/75">videos</figcaption>
      </figure>
    </div>
  );
}
