"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Film, Music, PenLine, Search, Upload } from "lucide-react";

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
        <p className="mt-4 max-w-[600px] text-[18px] leading-relaxed text-muted">Mavya walks you through every step. You only film the demo.</p>

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
                    <span className={`mt-1 block text-[20px] font-semibold tracking-[-0.015em] transition-colors ${on ? "text-text" : "text-muted group-hover:text-text"}`}>{s.title}</span>
                    <span className={`mt-2 block text-[16px] leading-relaxed transition-colors ${on ? "text-muted" : "text-soft"}`}>{s.body}</span>
                  </button>
                  {on && (
                    <Link href="/studio" className="-mt-2 mb-5 inline-flex items-center gap-1.5 text-[16px] font-semibold text-accent hover:underline">
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

/*
 * Step 1: the library like a research tool (same pattern as the Etsy Mavya keyword panel): the selected hook
 * plays on top with its numbers, a table of hooks below. Real hooks from the library with their real numbers;
 * click a row to play it, the rows also advance on their own.
 */
const HOOKS = [
  { code: "DcOiTp0xxTK", line: "Been living paycheck to paycheck for 3 yrs and NOW I find this??!", app: "Maxle", format: "Text + music", views: "5.6M", likes: "34.7K", comments: "126" },
  { code: "Dd--YQOqo16", line: "My sister is actually nuts why is this her wedding invitation", app: "Replit", format: "Text + music", views: "5.0M", likes: "221K", comments: "335" },
  { code: "DdCqlaoP67w", line: "bro rate my startup idea", app: "Mise", format: "Text + music", views: "4.8M", likes: "71.2K", comments: "380" },
  { code: "DdLjyNctVi9", line: "im so dead look what my sister just sent out to the WHOLE family", app: "Figma", format: "Voiceover", views: "3.6M", likes: "198K", comments: "523" },
  { code: "DbHo7QFIvD4", line: "pov: he airdrops you THIS", app: "Figma", format: "Text + music", views: "3.3M", likes: "29.8K", comments: "202" },
];
const HOOK_MS = 3500;
function LibraryPanel() {
  const [sel, pick] = useCycle(HOOKS.length, HOOK_MS);
  const h = HOOKS[sel];
  const stat = (label: string, value: string) => (
    <div>
      <p className="text-[12px] text-soft">{label}</p>
      <p className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-[-0.01em]">{value}</p>
    </div>
  );
  return (
    <div className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-semibold">Viral library</h3>
        <span className="flex h-9 w-[200px] items-center gap-2 rounded-lg bg-raised px-3 text-[13px] text-soft"><Search className="h-4 w-4" />Search hooks</span>
      </div>

      {/* the selected hook, playing, with its numbers */}
      <div key={h.code} className="mt-4 grid grid-cols-[118px_1fr] gap-5 animate-[hiw-fade_380ms_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none">
        <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-ink shadow-[0_16px_32px_-16px_rgba(21,18,31,0.6)]">
          <video src={`/landing/lib-${h.code}.mp4`} poster={`/landing/lib-${h.code}.jpg`} muted loop playsInline autoPlay aria-label={h.line} className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2 text-[12px] font-semibold">
            <span className="rounded-full bg-raised px-2 py-0.5 text-muted">{h.format}</span>
            <span className="rounded-full bg-accent-tint px-2 py-0.5 text-accent">Demo: {h.app}</span>
          </div>
          <p className="mt-2.5 text-[17px] font-semibold leading-snug tracking-[-0.01em]">“{h.line}”</p>
          <div className="mt-auto grid grid-cols-3 gap-3 border-t border-line pt-3">
            {stat("Views", h.views)}
            {stat("Likes", h.likes)}
            {stat("Comments", h.comments)}
          </div>
          <span className="btn-primary mt-3 h-9 w-fit px-4 text-[13px]">Use this hook</span>
        </div>
      </div>

      {/* the table */}
      <div className="mt-5 grid grid-cols-[1fr_64px_56px] gap-3 border-b border-line px-2 pb-2 text-[12px] font-semibold text-soft">
        <span>Hook</span>
        <span className="text-right">Views</span>
        <span className="text-right">Likes</span>
      </div>
      <div className="mt-1">
        {HOOKS.map((x, i) => (
          <button
            key={x.code}
            type="button"
            onClick={() => pick(i)}
            className={`grid w-full cursor-pointer grid-cols-[1fr_64px_56px] items-center gap-3 rounded-lg px-2 py-1 text-left transition-colors ${i === sel ? "bg-accent-tint" : "hover:bg-raised"}`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="h-[30px] w-[17px] shrink-0 rounded-[4px] bg-cover bg-center" style={{ backgroundImage: `url(/landing/lib-${x.code}.jpg)` }} />
              <span className={`truncate text-[13px] ${i === sel ? "font-semibold text-text" : "text-muted"}`}>{x.line}</span>
            </span>
            <span className="text-right text-[13px] font-semibold tabular-nums">{x.views}</span>
            <span className="text-right text-[13px] tabular-nums text-muted">{x.likes}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Shared by the step screens: which row is selected; it advances on its own until a row is clicked. */
function useCycle(count: number, ms: number) {
  const [sel, setSel] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => setSel((x) => (x + 1) % count), ms);
    return () => window.clearTimeout(t);
  }, [auto, sel, count, ms]);
  const pick = (i: number) => {
    setSel(i);
    setAuto(false);
  };
  return [sel, pick] as const;
}

/** The facts strip under a featured item: small label, big value (same as the library's Views / Likes / Comments). */
function Facts({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-auto grid grid-cols-3 gap-3 border-t border-line pt-3">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <p className="text-[12px] text-soft">{label}</p>
          <p className="mt-0.5 truncate text-[16px] font-semibold tracking-[-0.01em]">{value}</p>
        </div>
      ))}
    </div>
  );
}
const FEATURED = "mt-4 grid grid-cols-[118px_1fr] gap-5 animate-[hiw-fade_380ms_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none";
const MEDIA = "relative aspect-[9/16] overflow-hidden rounded-xl bg-ink shadow-[0_16px_32px_-16px_rgba(21,18,31,0.6)]";
const TAG = "rounded-full px-2 py-0.5 text-[12px] font-semibold";

/*
 * Step 2: the selected character large, with the hook it will perform and the three ways to get a character;
 * a grid of the cast below that cycles (70 in the library).
 */
const CAST = ["olivia", "ella", "jake", "sienna", "liam", "freya", "ava", "marcus", "zuri", "isla", "noah", "harper", "mei", "emma", "owen", "chloe"];
const CAST_TOTAL = 70;
function CharacterPanel() {
  const [sel, pick] = useCycle(CAST.length, 2600);
  const id = CAST[sel];
  const name = id[0].toUpperCase() + id.slice(1);
  return (
    <div className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-semibold">Choose your character</h3>
        <span className="text-[13px] text-soft">{CAST_TOTAL} in the library</span>
      </div>

      <div key={id} className={FEATURED}>
        <div className={MEDIA}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/characters/${id}.jpg`} alt={name} className="absolute inset-0 h-full w-full object-cover" />
          <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/55 px-2 py-1.5 backdrop-blur">
            <span className="block text-[10.5px] font-semibold text-white">Generating hook</span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/25">
              <span className="block h-full w-full origin-left animate-[hiw-grow_2600ms_linear_both] rounded-full bg-accent motion-reduce:animate-none" />
            </span>
          </span>
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className={`${TAG} bg-raised text-muted`}>AI character</span>
            <span className={`${TAG} bg-accent-tint text-accent`}>Hook: bro rate my startup idea</span>
          </div>
          <p className="mt-2.5 text-[22px] font-semibold tracking-[-0.015em]">{name}</p>
          <p className="mt-1 text-[13px] text-muted">Performs the hook in place of the original creator.</p>
          <div className="mt-auto flex flex-wrap gap-2 pt-3">
            <span className="btn-primary h-9 px-4 text-[13px]">Use {name}</span>
            <span className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-semibold"><Upload className="h-3.5 w-3.5" />Your photo</span>
            <span className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-semibold"><PenLine className="h-3.5 w-3.5" />Describe one</span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-b border-line px-0.5 pb-2 text-[12px] font-semibold text-soft">
        <span>Characters</span>
        <span>+{CAST_TOTAL - CAST.length} more</span>
      </div>
      <div className="mt-2.5 grid grid-cols-8 gap-2">
        {CAST.map((c, i) => (
          <button
            key={c}
            type="button"
            onClick={() => pick(i)}
            aria-label={c}
            className={`aspect-square cursor-pointer rounded-lg bg-raised bg-cover bg-center transition-[box-shadow,opacity] ${i === sel ? "ring-[3px] ring-accent" : "opacity-85 hover:opacity-100"}`}
            style={{ backgroundImage: `url(/characters/thumbs/${c}.jpg)` }}
          />
        ))}
      </div>
    </div>
  );
}

/*
 * Step 3: the demo playing with the current shot's brief (what to film, camera, length); the shot list below,
 * the shot on screen highlighted (times are this video's own scenes).
 */
const DEMO = { src: "/landing/lib-DbHo7QFIvD4.mp4", poster: "/landing/lib-DbHo7QFIvD4.jpg" };
const SHOTS = [
  { from: 0, to: 3, title: "Your hook", text: "Made by Mavya with your character.", camera: "Made by Mavya" },
  { from: 3, to: 7, title: "Show what you got", text: "Open the link on your laptop.", camera: "Over the shoulder" },
  { from: 7, to: 11, title: "The big question", text: "Film the first screen, then tap YES.", camera: "Close on the screen" },
  { from: 11, to: 16.5, title: "Pick an option", text: "Show the choices and pick one.", camera: "Close on the screen" },
  { from: 16.5, to: 21, title: "The payoff", text: "End on the result: it goes straight to his calendar.", camera: "Close on the screen" },
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
  const at = Math.max(0, SHOTS.findIndex((x) => t >= x.from && t < x.to));
  const shot = SHOTS[at];
  const seek = (i: number) => {
    const v = ref.current;
    if (v) v.currentTime = SHOTS[i].from + 0.05;
  };
  return (
    <div className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-semibold">Film your demo</h3>
        <span className="text-[13px] text-soft">4 shots, about 18 seconds</span>
      </div>

      <div className="mt-4 grid grid-cols-[118px_1fr] gap-5">
        <div className={MEDIA}>
          <video ref={ref} src={DEMO.src} poster={DEMO.poster} muted loop playsInline aria-label="A demo" className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div key={at} className="flex min-w-0 flex-col animate-[hiw-fade_300ms_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none">
          <div className="flex items-center gap-2">
            <span className={`${TAG} bg-accent-tint text-accent`}>{at === 0 ? "Hook" : `Shot ${at} of 4`}</span>
          </div>
          <p className="mt-2.5 text-[22px] font-semibold tracking-[-0.015em]">{shot.title}</p>
          <p className="mt-1 text-[14px] leading-snug text-muted">{shot.text}</p>
          <Facts items={[["Length", `${Math.round(shot.to - shot.from)}s`], ["Camera", shot.camera], ["Film on", at === 0 ? "Nothing" : "Your phone"]]} />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[28px_1fr_48px] gap-3 border-b border-line px-2 pb-2 text-[12px] font-semibold text-soft">
        <span>#</span>
        <span>Shot</span>
        <span className="text-right">Length</span>
      </div>
      <div className="mt-1">
        {SHOTS.map((x, i) => (
          <button key={x.title} type="button" onClick={() => seek(i)} className={`grid w-full cursor-pointer grid-cols-[28px_1fr_48px] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${i === at ? "bg-accent-tint" : "hover:bg-raised"}`}>
            <span className={`text-[13px] font-semibold tabular-nums ${i === at ? "text-accent" : "text-soft"}`}>{i === 0 ? "H" : i}</span>
            <span className={`truncate text-[13px] ${i === at ? "font-semibold text-text" : "text-muted"}`}>{x.title} <span className="text-soft">· {x.text}</span></span>
            <span className="text-right text-[13px] tabular-nums text-muted">{Math.round(x.to - x.from)}s</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/*
 * Step 4: the selected sound "playing" (visual only, nothing is played) with the part that plays; the sound
 * options below that cycle: trending songs, the hook's own sound, your own file.
 */
const SOUNDS = [
  { title: "Dracula", by: "JENNIE", type: "Trending", art: "linear-gradient(135deg,#7b4cfa,#b02f86)" },
  { title: "The hook's original sound", by: "Copied from the viral video", type: "Hook sound", art: "linear-gradient(135deg,#15121f,#4b3a8c)" },
  { title: "APT.", by: "ROSÉ & Bruno Mars", type: "Trending", art: "linear-gradient(135deg,#b02f86,#f4b860)" },
  { title: "Die With A Smile", by: "Lady Gaga & Bruno Mars", type: "Trending", art: "linear-gradient(135deg,#2a5bd7,#7b4cfa)" },
  { title: "Your own sound", by: "Any audio or video file", type: "Upload", art: "linear-gradient(135deg,#4d4a5e,#928fa6)" },
];
function SoundPanel() {
  const [sel, pick] = useCycle(SOUNDS.length, 3200);
  const x = SOUNDS[sel];
  const wave = Array.from({ length: 64 }, (_, i) => 6 + Math.round(Math.abs(Math.sin(i * 1.3 + sel) * 14 + Math.sin(i * 0.37) * 8)));
  return (
    <div className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-semibold">Add sound</h3>
        <span className="flex h-9 w-[200px] items-center gap-2 rounded-lg bg-raised px-3 text-[13px] text-soft"><Search className="h-4 w-4" />Search songs</span>
      </div>

      <div key={x.title} className={FEATURED}>
        <div className="relative flex aspect-[9/16] flex-col items-center justify-center gap-3 overflow-hidden rounded-xl shadow-[0_16px_32px_-16px_rgba(21,18,31,0.6)]" style={{ background: x.art }}>
          {x.type === "Upload" ? <Upload className="h-8 w-8 text-white" /> : x.type === "Hook sound" ? <Film className="h-8 w-8 text-white" /> : <Music className="h-8 w-8 text-white" />}
          <span aria-hidden className="flex h-7 items-end gap-[3px]">
            {[14, 22, 10, 26, 16, 20, 12].map((h, i) => (
              <span key={i} className="w-[3px] origin-bottom rounded-full bg-white/85 animate-[hiw-eq_1s_ease-in-out_infinite] motion-reduce:animate-none" style={{ height: h, animationDelay: `${i * 0.13}s` }} />
            ))}
          </span>
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className={`${TAG} ${x.type === "Trending" ? "bg-accent-tint text-accent" : "bg-raised text-muted"}`}>{x.type}</span>
          </div>
          <p className="mt-2.5 truncate text-[22px] font-semibold tracking-[-0.015em]">{x.title}</p>
          <p className="mt-0.5 truncate text-[14px] text-muted">{x.by}</p>
          {/* the whole sound; the part under the video is coloured */}
          <div aria-hidden className="mt-3 flex h-9 items-center gap-[2px]">
            {wave.map((h, i) => <span key={i} className={`w-[3px] shrink-0 rounded-full ${i >= 18 && i < 44 ? "bg-accent" : "bg-line-strong"}`} style={{ height: h }} />)}
          </div>
          <div className="mt-auto flex items-center gap-3 pt-3">
            <span className="btn-primary h-9 px-4 text-[13px]">Use this sound</span>
            <span className="text-[13px] text-muted">Plays under the whole video</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_90px] gap-3 border-b border-line px-2 pb-2 text-[12px] font-semibold text-soft">
        <span>Sound</span>
        <span className="text-right">Type</span>
      </div>
      <div className="mt-1">
        {SOUNDS.map((o, i) => (
          <button key={o.title} type="button" onClick={() => pick(i)} className={`grid w-full cursor-pointer grid-cols-[1fr_90px] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${i === sel ? "bg-accent-tint" : "hover:bg-raised"}`}>
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="h-[26px] w-[26px] shrink-0 rounded-md" style={{ background: o.art }} />
              <span className={`truncate text-[13px] ${i === sel ? "font-semibold text-text" : "text-muted"}`}>{o.title} <span className="font-normal text-soft">· {o.by}</span></span>
            </span>
            <span className={`text-right text-[12.5px] ${i === sel ? "font-semibold text-accent" : "text-muted"}`}>{o.type}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
