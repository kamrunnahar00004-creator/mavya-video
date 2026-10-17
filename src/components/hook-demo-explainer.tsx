"use client";

import { useEffect, useRef, useState } from "react";

const clock = (s: number) => `0:${String(Math.floor(s)).padStart(2, "0")}`;

/**
 * Landing: what a hook + demo video is, shown with a real one. A real phone plays it on a loop (only while on
 * screen); under it, the video's own frames as a timeline, the hook part outlined, with a playhead on the video's
 * clock. Beside it, the definition and the volume idea as one colourful equation in the app's track colours.
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
    <div className="relative overflow-hidden rounded-[28px] border border-line bg-panel">
      {/* soft colour behind the phone */}
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,var(--accent-tint),transparent)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 left-40 h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,var(--sound-track-tint),transparent)] opacity-70" />
      <div className="relative grid items-center gap-14 px-6 py-14 sm:px-12 sm:py-16 lg:grid-cols-[auto_1fr] lg:gap-20 lg:px-16">
        <div className="mx-auto w-[250px]">
          {/* a real phone, like the hero ones */}
          <div className="relative rounded-[38px] bg-ink p-[7px] shadow-[0_34px_70px_-26px_rgba(21,18,31,0.6)]">
            <div className="relative aspect-[9/19.5] overflow-hidden rounded-[31px] bg-[#14121f]">
              <video ref={ref} poster={poster} muted loop playsInline preload="none" aria-label="A hook + demo video" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute left-1/2 top-2.5 h-[18px] w-[72px] -translate-x-1/2 rounded-full bg-black" />
              <span className={`absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-bold text-white transition-colors ${inHook ? "bg-accent" : "bg-black/60"}`}>{inHook ? "Hook" : "Demo"}</span>
            </div>
          </div>
          {/* the video's own frames as its timeline; the hook part outlined; the playhead on the video's clock */}
          <div className="relative mt-6">
            <div className="relative h-[60px] overflow-hidden rounded-lg bg-[#14121f]" style={{ backgroundImage: `url(${strip})`, backgroundSize: "100% 100%" }}>
              <span className="absolute inset-y-0 right-0 bg-[#14121f]/35" style={{ left: `${hookPct}%` }} />
              <span className="absolute inset-y-0 left-0 rounded-l-lg ring-[3px] ring-inset ring-accent" style={{ width: `${hookPct}%` }} />
              <span className="absolute -inset-y-1 w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(21,18,31,0.5)]" style={{ left: `${Math.min(100, (t / length) * 100)}%` }} />
            </div>
            <div className="mt-2 flex text-[11.5px] font-bold">
              <span className="text-accent" style={{ width: `${hookPct}%` }}>Hook</span>
              <span className="text-muted">Demo</span>
              <span className="ml-auto font-semibold tabular-nums text-soft">{clock(length)}</span>
            </div>
          </div>
        </div>

        <div className="max-w-[600px]">
          <h2 className="text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[40px] xl:text-[42px]">What’s a <span className="whitespace-nowrap">hook + demo</span> video?</h2>
          <p className="mt-5 text-[18px] leading-relaxed text-muted sm:text-[19px]">
            A scroll-stopping face <span className="font-semibold text-accent">(the hook)</span> followed by your product in action <span className="font-semibold text-accent">(the demo)</span>.
          </p>
          <div className="mt-12">
            <p className="text-[15px] font-semibold text-soft">The game is volume.</p>
            <VolumeNetwork />
            <p className="mt-5 text-[18px] leading-relaxed text-muted">More videos, more shots at going viral.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * The volume idea as a small network, in the brand violet: 10 hooks (left) each connect to all 10 demos (middle);
 * each demo feeds its row of 10 videos (right, 9:16 tiles) = 100. A few links pulse to show the combining.
 */
const NET_ROWS = Array.from({ length: 10 }, (_, i) => 14 + i * 21.5);
const NET_PULSE = [[0, 3], [2, 7], [4, 1], [5, 9], [7, 4], [9, 6], [1, 5], [8, 0]];

function VolumeNetwork() {
  const hx = 18;
  const dx = 196;
  const vx = 300;
  return (
    <figure className="mt-5">
      <svg viewBox="0 0 520 228" className="h-auto w-full max-w-[520px]" role="img" aria-label="10 hooks times 10 demos makes 100 videos">
        {/* every hook to every demo */}
        {NET_ROWS.map((a, i) => NET_ROWS.map((b, j) => <line key={`${i}-${j}`} x1={hx} y1={a} x2={dx} y2={b} stroke="var(--accent)" strokeOpacity="0.13" strokeWidth="1" />))}
        {/* a few links light up */}
        {NET_PULSE.map(([i, j], k) => (
          <line key={`p${k}`} x1={hx} y1={NET_ROWS[i]} x2={dx} y2={NET_ROWS[j]} stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" className="animate-[net-pulse_3.2s_ease-in-out_infinite]" style={{ animationDelay: `${k * 0.4}s` }} />
        ))}
        {/* each demo feeds its row of videos */}
        {NET_ROWS.map((b, j) => <line key={`r${j}`} x1={dx} y1={b} x2={vx - 6} y2={b} stroke="var(--accent)" strokeOpacity="0.22" strokeWidth="1" />)}
        {/* hooks: filled */}
        {NET_ROWS.map((y, i) => <circle key={`h${i}`} cx={hx} cy={y} r="6" fill="var(--accent)" />)}
        {/* demos: rings */}
        {NET_ROWS.map((y, j) => <circle key={`d${j}`} cx={dx} cy={y} r="6" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />)}
        {/* 100 videos: 9:16 tiles */}
        {NET_ROWS.map((y, j) => Array.from({ length: 10 }, (_, k) => (
          <rect key={`v${j}-${k}`} x={vx + k * 21} y={y - 8} width="9" height="16" rx="2" fill="var(--accent)" fillOpacity={0.35 + ((j * 10 + k) % 7) * 0.09} />
        )))}
      </svg>
      <figcaption className="mt-3 grid max-w-[520px] grid-cols-[196px_104px_1fr] text-[14px] font-semibold text-muted">
        <span><span className="text-text">10</span> hooks</span>
        <span><span className="text-text">10</span> demos</span>
        <span className="text-right sm:text-left"><span className="text-accent">100</span> videos</span>
      </figcaption>
    </figure>
  );
}
