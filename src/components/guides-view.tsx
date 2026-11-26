"use client";

import { useEffect, useRef, useState } from "react";
import { GUIDES } from "@/lib/guides";

/** Guides: pick a guide, then its steps in order, each with a screenshot of the real app (click to open it full size). */
export function GuidesView() {
  const [open, setOpen] = useState(GUIDES[0].id);
  const guide = GUIDES.find((g) => g.id === open) ?? GUIDES[0];
  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <header className="border-b border-line bg-panel px-6 py-4">
        <h1 className="text-[20px] font-extrabold tracking-tight">Guides</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-6 py-6">
          <div role="tablist" aria-label="Guides" className="grid gap-3 sm:grid-cols-2">
            {GUIDES.map((g) => (
              <button key={g.id} type="button" role="tab" aria-selected={g.id === guide.id} onClick={() => setOpen(g.id)}
                className={`cursor-pointer border-2 p-4 text-left transition-colors ${g.id === guide.id ? "border-accent bg-accent-tint" : "border-line hover:border-line-strong"}`}>
                <span className="block text-[15px] font-bold">{g.title}</span>
                <span className="mt-1 block text-[13px] text-muted">{g.summary} {g.steps.length} steps.</span>
              </button>
            ))}
          </div>
          <ol className="mt-8 space-y-10">
            {guide.steps.map((s, i) => (
              <li key={s.title}>
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-accent text-[13px] font-bold text-white">{i + 1}</span>
                  <div>
                    <h2 className="text-[17px] font-bold leading-7">{s.title}</h2>
                    <p className="mt-1 text-[14px] leading-relaxed text-muted">{s.text}</p>
                  </div>
                </div>
                {s.video ? (
                  // A short loop of the real app (founder 2026-11-26: stills alone "look shit"). Muted, so it can autoplay.
                  <GuideClip src={s.video} poster={s.image} label={s.alt} eager={i < 3} />
                ) : (
                  <a href={s.image} target="_blank" rel="noreferrer" className="mt-3 block border border-line shadow-[0_8px_24px_-12px_rgba(21,18,31,0.25)] transition-shadow hover:shadow-[0_12px_32px_-12px_rgba(21,18,31,0.35)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.image} alt={s.alt} loading={i < 2 ? "eager" : "lazy"} className="block h-auto w-full" />
                  </a>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

/**
 * One guide clip: a muted loop that plays by itself (browsers only autoplay muted video). Click, Enter or Space pauses
 * and resumes it (Codex 2026-11-26: motion must be stoppable); with "reduce motion" on it starts paused.
 */
function GuideClip({ src, poster, label, eager }: { src: string; poster: string; label: string; eager: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  // Follows the video itself (onPlay / onPause), so it is right however playback starts or stops.
  const [paused, setPaused] = useState(true);
  useEffect(() => {
    const v = ref.current;
    if (v && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) void v.play().catch(() => undefined);
  }, []);
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined); else v.pause();
  };
  return (
    <div className="relative mt-3">
      <video ref={ref} src={src} poster={poster} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} muted loop playsInline preload={eager ? "auto" : "metadata"} aria-label={label}
        className="block h-auto w-full border border-line shadow-[0_8px_24px_-12px_rgba(21,18,31,0.25)]" />
      <button type="button" onClick={toggle} aria-label={paused ? `Play: ${label}` : `Pause: ${label}`}
        className="absolute inset-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        {paused && <span className="absolute bottom-3 right-3 bg-ink/75 px-2.5 py-1 text-[12px] font-semibold text-white">Play</span>}
      </button>
    </div>
  );
}
