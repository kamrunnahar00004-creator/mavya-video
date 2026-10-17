"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Download, Film, Music, PenLine, Search, Type, Upload, Users } from "lucide-react";

/*
 * How it works, in the Etsy Mavya "Research" layout (2026-10-17): the steps on the left, the active one marked
 * by a violet rail that fills while the steps advance on their own (every 7 s, paused on hover, stopped once a
 * step is clicked); on the right, that step's screen in a browser window. The screens are drawn in code from
 * real material (library covers, the AI cast, a real demo video); they illustrate the app, they are not live.
 */
const ROTATE_MS = 7000;

const STEPS = [
  { key: "hook", title: "Steal a viral hook", body: "Browse hooks that already did millions of views. Pick one and make it yours.", url: "mavya.app/library", Panel: LibraryPanel },
  { key: "remix", title: "Remix it with your character", body: "Generate one, pick one from our library, or upload your photo. Mavya makes the hook, no filming.", url: "mavya.app/studio/new/character", Panel: CharacterPanel },
  { key: "demo", title: "Film the demo, shot by shot", body: "Mavya describes every shot of the demo. Film it on your phone and drop it in.", url: "mavya.app/studio/new/demo", Panel: DemoPanel },
  { key: "sound", title: "Copy the viral sound", body: "Use the hook's original sound or a trending song, then export.", url: "mavya.app/studio/new/sound", Panel: SoundPanel },
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
                <div className="h-[560px] overflow-hidden text-left">
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
/** Step 1: the library, sorted by views: two complete rows, the last tile says there are more. */
const LIBRARY: [string, string][] = [
  ["DcOiTp0xxTK", "5.6M"], ["Dd--YQOqo16", "5.0M"], ["DdCqlaoP67w", "4.8M"], ["DdLjyNctVi9", "3.6M"], ["DbHo7QFIvD4", "3.3M"],
  ["DWp_8nwCPSF", "1.8M"], ["DeDo3iHKIKh", "1.6M"], ["DajwiOOtvDL", "1.6M"], ["DaFCnEnNxTM", "1.6M"],
];
function LibraryPanel() {
  return (
    <div className="flex h-full flex-col p-5 sm:p-6">
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
      <div className="mt-4 grid grid-cols-5 gap-2.5">
        {LIBRARY.map(([code, views], i) => (
          <div key={code} className={`relative aspect-[9/16] overflow-hidden rounded-lg bg-raised bg-cover bg-center ${i === 3 ? "ring-[3px] ring-accent" : ""}`} style={{ backgroundImage: `url(${cover(code)})` }}>
            <span className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent" />
            <span className="absolute bottom-1.5 left-2 text-[11px] font-bold text-white">▶ {views}</span>
            {i === 3 && <span className="absolute left-1.5 top-1.5 rounded-md bg-accent px-1.5 py-0.5 text-[10.5px] font-bold text-white">Use this hook</span>}
          </div>
        ))}
        <div className="flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-lg border border-line bg-raised text-center">
          <Search className="h-5 w-5 text-accent" />
          <span className="px-2 text-[12.5px] font-semibold leading-tight">Browse all hooks</span>
        </div>
      </div>
    </div>
  );
}

/** Step 2: make your character three ways; three complete rows of the cast, the last tile says how many more (70 in all). */
const CAST = ["olivia", "zuri", "mei", "jake", "ella", "sienna", "simone", "yuna", "liam", "ava", "amara", "isla", "hana", "marcus", "mia", "jada", "freya"];
const CAST_TOTAL = 70;
function CharacterPanel() {
  const box = "flex h-[74px] flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-[13px] font-semibold text-text";
  return (
    <div className="flex h-full flex-col p-5 sm:p-6">
      <h3 className="text-[16px] font-semibold">Choose your character</h3>
      <div className="mt-4 flex gap-3">
        <span className={box}><Upload className="h-5 w-5 text-accent" />Upload your photo</span>
        <span className={box}><PenLine className="h-5 w-5 text-accent" />Describe your character</span>
      </div>
      <p className="mt-5 text-[13px] font-semibold text-muted">Or pick from the library</p>
      <div className="mt-2.5 grid grid-cols-6 gap-2">
        {CAST.map((id, i) => (
          <span key={id} className={`relative aspect-square overflow-hidden rounded-lg bg-raised bg-cover bg-center ${i === 0 ? "ring-[3px] ring-accent" : ""}`} style={{ backgroundImage: `url(/characters/thumbs/${id}.jpg)` }}>
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10.5px] font-semibold capitalize text-white">{id}</span>
          </span>
        ))}
        <span className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-line bg-raised">
          <Users className="h-4 w-4 text-accent" />
          <span className="text-[12.5px] font-semibold">+{CAST_TOTAL - CAST.length} more</span>
        </span>
      </div>
    </div>
  );
}

/*
 * Step 3: the shot list on the left, the demo playing on the right; the shot on screen lights up (times are
 * this video's own scenes: the link opens, the question, picking a date idea, the calendar).
 */
const DEMO = { src: "/landing/lib-DbHo7QFIvD4.mp4", poster: "/landing/lib-DbHo7QFIvD4.jpg" };
const SHOTS = [
  { from: 0, to: 3, title: "Your hook", text: "Made by Mavya with your character." },
  { from: 3, to: 7, title: "Show what you got", text: "Phone over the laptop. Open the link." },
  { from: 7, to: 11, title: "The big question", text: "Film the first screen, then tap YES." },
  { from: 11, to: 16.5, title: "Pick an option", text: "Show the choices and pick one." },
  { from: 16.5, to: 21, title: "The payoff", text: "End on the result: it goes straight to his calendar." },
];
function DemoPanel() {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      setT(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) void v.play().catch(() => undefined);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const at = SHOTS.findIndex((s) => t >= s.from && t < s.to);
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_200px] gap-5 p-5 sm:p-6">
      <div>
        <h3 className="text-[16px] font-semibold">Film your demo</h3>
        <p className="mt-1 text-[13px] text-muted">4 shots, about 18 seconds</p>
        <ol className="mt-4 space-y-2">
          {SHOTS.map((s, i) => {
            const on = i === at;
            return (
              <li key={s.title} className={`rounded-xl border px-3.5 py-2.5 transition-colors duration-300 ${on ? "border-accent bg-accent-tint" : "border-line"}`}>
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold transition-colors duration-300 ${on ? "bg-accent text-white" : "bg-raised text-muted"}`}>{i === 0 ? "H" : i}</span>
                  <span className={`text-[14px] font-semibold ${on ? "text-text" : "text-muted"}`}>{s.title}</span>
                  <span className="ml-auto text-[11.5px] tabular-nums text-soft">{Math.round(s.to - s.from)}s</span>
                </div>
                <p className={`mt-1 pl-[34px] text-[12.5px] leading-snug ${on ? "text-muted" : "text-soft"}`}>{s.text}</p>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex items-center">
        <div className="w-full rounded-[28px] bg-ink p-[5px] shadow-[0_24px_50px_-24px_rgba(21,18,31,0.55)]">
          <div className="relative aspect-[9/19.5] overflow-hidden rounded-[23px] bg-black">
            <video ref={ref} src={DEMO.src} poster={DEMO.poster} muted loop playsInline aria-label="A demo" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute left-1/2 top-2 h-3.5 w-14 -translate-x-1/2 rounded-full bg-black" />
            {at >= 0 && <span className="absolute bottom-2.5 left-2.5 rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-bold text-white">{at === 0 ? "Hook" : `Shot ${at}`}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Step 4: a trending song picked (shown, not played), on the timeline under the clips, ready to export. */
const SONG = { title: "Dracula", artist: "JENNIE" };
function SoundPanel() {
  const bars = Array.from({ length: 48 }, (_, i) => 10 + Math.round(Math.abs(Math.sin(i * 1.3) * 16 + Math.sin(i * 0.37) * 10)));
  const wave = Array.from({ length: 150 }, (_, i) => 6 + Math.round(Math.abs(Math.sin(i * 1.7) * 9 + Math.sin(i * 0.45) * 6)));
  return (
    <div className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-semibold">Add sound</h3>
        <span className="btn-primary h-9 px-4 text-[13px]"><Download className="h-4 w-4" />Export</span>
      </div>
      {/* the song, playing (visual only) */}
      <div className="mt-5 flex items-center gap-4 rounded-2xl bg-[#15121f] p-4 text-white">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#7b4cfa,#b02f86)] shadow-[0_10px_24px_-10px_rgba(123,76,250,0.8)]">
          <Music className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[16px] font-semibold">{SONG.title}</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-bold text-[#b69cff]">Trending</span>
          </div>
          <div className="text-[13px] text-white/60">{SONG.artist}</div>
          <div aria-hidden className="mt-2.5 flex h-8 items-center gap-[3px]">
            {bars.map((h, i) => (
              <span key={i} className="w-[3px] shrink-0 origin-center rounded-full bg-[#b69cff] animate-[hiw-eq_1.1s_ease-in-out_infinite] motion-reduce:animate-none" style={{ height: h, animationDelay: `${(i % 8) * 0.12}s` }} />
            ))}
          </div>
        </div>
      </div>
      {/* the other ways to add sound */}
      <div className="mt-3 divide-y divide-line rounded-xl border border-line">
        {[
          { icon: Film, title: "The hook's original sound", sub: "Copied from the viral video" },
          { icon: Search, title: "Browse trending songs", sub: "Search any song" },
          { icon: Upload, title: "Upload your own", sub: "Any audio or video file" },
        ].map((o) => (
          <div key={o.title} className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent"><o.icon className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold">{o.title}</span>
              <span className="block text-[12px] text-soft">{o.sub}</span>
            </span>
            <span className="rounded-lg border border-line px-3 py-1 text-[12px] font-semibold text-muted">Use</span>
          </div>
        ))}
      </div>
      {/* the timeline: clips, text, the song */}
      <div className="mt-4 space-y-1.5 rounded-xl border border-line p-3">
        <div className="flex h-9 gap-0.5 overflow-hidden rounded-md">
          <span className="flex w-[22%] items-center gap-1 bg-cover bg-center px-2 text-[10.5px] font-bold text-white" style={{ backgroundImage: "linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)),url(/characters/olivia.jpg)" }}><Film className="h-3 w-3" />Hook</span>
          <span className="flex flex-1 items-center gap-1 bg-cover bg-center px-2 text-[10.5px] font-bold text-white" style={{ backgroundImage: "linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)),url(/landing/explain-strip.jpg)", backgroundSize: "100% 100%" }}><Film className="h-3 w-3" />Demo</span>
        </div>
        <div className="flex h-6 w-[22%] items-center gap-1 rounded-md bg-texttrack-tint px-2 text-[10.5px] font-semibold text-texttrack"><Type className="h-3 w-3 shrink-0" /><span className="truncate">pov: he airdrops you this</span></div>
        <div className="flex h-8 items-center gap-1.5 overflow-hidden rounded-md bg-soundtrack-tint px-2 text-soundtrack">
          <Music className="h-3.5 w-3.5 shrink-0" />
          <span className="shrink-0 text-[10.5px] font-bold">{SONG.title} · {SONG.artist}</span>
          <span className="flex h-full flex-1 items-center gap-[2px]">
            {wave.map((h, i) => <span key={i} className="w-[2px] shrink-0 rounded-full bg-soundtrack/60" style={{ height: h }} />)}
          </span>
        </div>
      </div>
    </div>
  );
}
