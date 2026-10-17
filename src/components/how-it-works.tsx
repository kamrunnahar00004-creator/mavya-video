"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Download, Film, Music, Search, Sparkles, Type, Upload } from "lucide-react";

/*
 * How it works, in the Etsy Mavya "Research" layout (2026-10-17): the steps on the left, the active one marked
 * by a violet rail that fills while the steps advance on their own (every 7 s, paused on hover, stopped once a
 * step is clicked); on the right, that step's screen in a browser window. The screens are drawn in code from
 * real material (library covers, the AI cast, demo frames); they illustrate the app, they are not live.
 */
const ROTATE_MS = 7000;

const STEPS = [
  { key: "hook", title: "Steal a viral hook", body: "Browse hooks that already pulled millions of views. Pick one and make it yours.", url: "mavya.app/library", Panel: LibraryPanel },
  { key: "remix", title: "Remix it with an AI creator", body: "Pick one of 70 characters or your own face. Mavya makes the hook, no filming.", url: "mavya.app/studio/new/character", Panel: RemixPanel },
  { key: "demo", title: "Film the demo, shot by shot", body: "Mavya tells you exactly what to film: the problem, your product, the magic moment, the result.", url: "mavya.app/studio/new/demo", Panel: ShotListPanel },
  { key: "edit", title: "Edit, add sound, export", body: "A built-in editor with trending songs. Every hook, demo and sound is saved to reuse.", url: "mavya.app/studio/new/edit", Panel: EditorPanel },
];

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [hovering, setHovering] = useState(false);
  const running = auto && !hovering;
  useEffect(() => {
    if (!running) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => setActive((a) => (a + 1) % STEPS.length), ROTATE_MS);
    return () => window.clearTimeout(t);
  }, [running, active]);
  const pick = (i: number) => {
    setActive(i);
    setAuto(false);
  };
  const current = STEPS[active];
  return (
    <section id="how" className="scroll-mt-24 overflow-x-clip py-20 sm:py-28">
      <div className="mx-auto max-w-[1160px] px-5">
        <p className="text-[14px] font-semibold text-accent">How it works</p>
        <h2 className="mt-2 max-w-[680px] text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">From viral hook to finished video.</h2>
        <p className="mt-4 max-w-[600px] text-[17px] leading-relaxed text-muted">Mavya walks you through every step. You only film the demo.</p>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
          <div role="tablist" aria-orientation="vertical" aria-label="How it works" className="flex flex-col">
            {STEPS.map((s, i) => {
              const on = i === active;
              return (
                <div key={s.key} className="relative pl-7">
                  <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-line" />
                  {on && (
                    <span
                      key={`${active}-${running}`}
                      aria-hidden
                      className={`absolute inset-y-0 left-0 w-[3px] origin-top bg-accent ${running ? "animate-[hiw-rail_linear_both] motion-reduce:animate-none" : ""}`}
                      style={running ? { animationDuration: `${ROTATE_MS}ms` } : undefined}
                    />
                  )}
                  <button type="button" role="tab" aria-selected={on} aria-controls="hiw-panel" onClick={() => pick(i)} className="group block w-full cursor-pointer py-5 text-left">
                    <span className={`block text-[13px] font-semibold tabular-nums transition-colors ${on ? "text-accent" : "text-soft"}`}>Step {i + 1}</span>
                    <span className={`mt-1 block text-[21px] font-semibold tracking-[-0.015em] transition-colors ${on ? "text-text" : "text-muted group-hover:text-text"}`}>{s.title}</span>
                    <span className={`mt-2 block text-[15.5px] leading-relaxed transition-colors ${on ? "text-muted" : "text-soft"}`}>{s.body}</span>
                  </button>
                  {on && (
                    <Link href="/studio" className="-mt-2 mb-5 inline-flex items-center gap-1.5 text-[15px] font-semibold text-accent hover:underline">
                      Try it free <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>

          <div className="relative">
            <div aria-hidden className="pointer-events-none absolute -inset-10 bg-[radial-gradient(55%_50%_at_50%_45%,rgba(123,76,250,0.12)_0%,transparent_100%)]" />
            <div id="hiw-panel" role="tabpanel" key={current.key} className="relative animate-[hiw-fade_380ms_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none">
              <AppWindow url={current.url}>
                <div className="text-left sm:min-h-[540px]">
                  <current.Panel />
                </div>
              </AppWindow>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AppWindow({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_rgba(21,18,31,0.05),0_2px_6px_rgba(21,18,31,0.04),0_40px_90px_-30px_rgba(21,18,31,0.24)]">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="mx-auto truncate rounded-md border border-line bg-panel px-3 py-1 text-[12px] text-soft">{url}</span>
        <span className="w-[42px]" aria-hidden />
      </div>
      {children}
    </div>
  );
}

const cover = (code: string) => `/landing/lib-${code}.jpg`;

/** Step 1: the library, sorted by views, one hook picked. */
function LibraryPanel() {
  const hooks: [string, string, string][] = [
    ["DcOiTp0xxTK", "5.6M", "35K"], ["DdLjyNctVi9", "3.6M", "198K"], ["DbHo7QFIvD4", "3.3M", "30K"],
    ["Dd--YQOqo16", "5.0M", "221K"], ["DdCqlaoP67w", "4.8M", "71K"], ["DbtW-sFSSlP", "5.1M", "169K"],
  ];
  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-semibold">Viral library</h3>
        <span className="flex h-9 w-[220px] items-center gap-2 rounded-lg bg-raised px-3 text-[13px] text-soft"><Search className="h-4 w-4" />Search hooks</span>
      </div>
      <div className="mt-4 flex items-center gap-5 border-b border-line text-[13px] font-semibold">
        <span className="-mb-px border-b-2 border-ink pb-2 text-text">All</span>
        <span className="pb-2 text-soft">Text + music</span>
        <span className="pb-2 text-soft">Voiceover</span>
        <span className="ml-auto flex items-center gap-1 pb-2 text-muted">Most viewed <ChevronDown className="h-3.5 w-3.5" /></span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {hooks.map(([code, views, likes], i) => (
          <div key={code} className={`relative aspect-[9/14] overflow-hidden rounded-xl bg-cover bg-center ${i === 1 ? "ring-[3px] ring-accent" : ""}`} style={{ backgroundImage: `url(${cover(code)})` }}>
            <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
            <span className="absolute bottom-2 left-2 flex gap-2 text-[11px] font-bold text-white">
              <span>▶ {views}</span>
              <span className="text-white/80">♥ {likes}</span>
            </span>
            {i === 1 && <span className="absolute left-2 top-2 rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-white">Use this hook</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Step 2: the stolen hook, the creator picked, the hook being made. */
function RemixPanel() {
  const cast = ["olivia", "ella", "jake", "sienna", "liam", "freya", "marcus", "ava"];
  return (
    <div className="p-5 sm:p-6">
      <h3 className="text-[16px] font-semibold">Remix the hook</h3>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <figure>
          <div className="aspect-[9/14] overflow-hidden rounded-xl bg-cover bg-center" style={{ backgroundImage: `url(${cover("DdLjyNctVi9")})` }} />
          <figcaption className="mt-2 text-[12px] font-semibold text-muted">Viral hook · 3.6M views</figcaption>
        </figure>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-tint text-accent"><Sparkles className="h-5 w-5" /></span>
        <figure>
          <div className="relative aspect-[9/14] overflow-hidden rounded-xl bg-cover bg-center ring-[3px] ring-accent" style={{ backgroundImage: "url(/characters/olivia.jpg)" }}>
            <span className="absolute inset-x-3 bottom-3 rounded-lg bg-black/60 p-2.5 backdrop-blur">
              <span className="block text-[11px] font-semibold text-white">Generating your hook</span>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/20">
                <span className="block h-full w-2/3 rounded-full bg-accent" />
              </span>
            </span>
          </div>
          <figcaption className="mt-2 text-[12px] font-semibold text-muted">Your hook · Olivia</figcaption>
        </figure>
      </div>
      <p className="mt-5 text-[13px] font-semibold text-muted">Choose your creator</p>
      <div className="mt-2 grid grid-cols-8 gap-2">
        {cast.map((id, i) => (
          <span key={id} className={`aspect-square rounded-lg bg-cover bg-center ${i === 0 ? "ring-[3px] ring-accent" : ""}`} style={{ backgroundImage: `url(/characters/thumbs/${id}.jpg)` }} />
        ))}
      </div>
    </div>
  );
}

/** Step 3: the shot list for the demo, one shot opened, one already filmed. */
function ShotListPanel() {
  const shots = [
    { t: "Show the problem", s: "2s", done: true },
    { t: "Open your product", s: "1.5s", open: true },
    { t: "The magic moment", s: "3s" },
    { t: "The result", s: "2s" },
  ];
  return (
    <div className="p-5 sm:p-6">
      <h3 className="text-[16px] font-semibold">Film your demo</h3>
      <p className="mt-1 text-[13px] text-muted">4 shots, about 9 seconds</p>
      <div className="mt-4 space-y-2.5">
        {shots.map((x, i) => (
          <div key={x.t} className={`rounded-xl border bg-panel ${x.open ? "border-accent" : "border-line"}`}>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold ${x.done ? "bg-accent text-white" : "bg-raised text-muted"}`}>{x.done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="text-[14px] font-semibold">{x.t}</span> <span className="text-[12.5px] text-soft">~{x.s}</span>
              </span>
              {x.done ? (
                <span className="h-10 w-6 rounded-md bg-cover bg-center" style={{ backgroundImage: "url(/landing/mx-demo-1.jpg)" }} />
              ) : (
                <span className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold"><Upload className="h-3.5 w-3.5" />Upload clip</span>
              )}
            </div>
            {x.open && (
              <div className="border-t border-line px-4 py-3 text-[13px] text-muted">
                <p><span className="font-semibold text-text">Camera:</span> over your shoulder, screen fills the frame</p>
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
                  <li>Open your site or app</li>
                  <li>Let it fully load</li>
                </ol>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Step 4: the editor, with the clips, a text and a song on the timeline, ready to export. */
function EditorPanel() {
  const bars = Array.from({ length: 150 }, (_, i) => 6 + Math.round(Math.abs(Math.sin(i * 1.7) * 9 + Math.sin(i * 0.45) * 6)));
  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-semibold">Edit video</h3>
        <span className="btn-primary h-9 px-4 text-[13px]"><Download className="h-4 w-4" />Export</span>
      </div>
      <div className="mt-4 flex justify-center">
        <div className="relative aspect-[9/16] w-[150px] overflow-hidden rounded-xl bg-cover bg-center" style={{ backgroundImage: "url(/characters/olivia.jpg)" }}>
          <p className="absolute inset-x-2 top-[18%] text-center text-[12.5px] font-black leading-tight text-white [-webkit-text-stroke:3px_#000] [paint-order:stroke_fill]">This app fixed my mornings</p>
        </div>
      </div>
      <div className="mt-4 space-y-1.5 rounded-xl border border-line p-3">
        <div className="flex h-9 gap-0.5 overflow-hidden rounded-md">
          <span className="flex w-[34%] items-center gap-1 bg-cover bg-center px-2 text-[10.5px] font-bold text-white" style={{ backgroundImage: "linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)),url(/characters/olivia.jpg)" }}><Film className="h-3 w-3" />Hook</span>
          <span className="flex flex-1 items-center gap-1 bg-cover bg-center px-2 text-[10.5px] font-bold text-white" style={{ backgroundImage: "linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)),url(/landing/explain-strip.jpg)" }}><Film className="h-3 w-3" />Demo</span>
        </div>
        <div className="flex h-6 w-[34%] items-center gap-1 rounded-md bg-texttrack-tint px-2 text-[10.5px] font-semibold text-texttrack"><Type className="h-3 w-3" />This app fixed my mornings</div>
        <div className="flex h-8 items-center gap-1.5 overflow-hidden rounded-md bg-soundtrack-tint px-2 text-soundtrack">
          <Music className="h-3.5 w-3.5 shrink-0" />
          <span className="shrink-0 text-[10.5px] font-bold">Trending sound</span>
          <span className="flex h-full flex-1 items-center gap-[2px]">
            {bars.map((h, i) => <span key={i} className="w-[2px] shrink-0 rounded-full bg-soundtrack/60" style={{ height: h }} />)}
          </span>
        </div>
      </div>
    </div>
  );
}
