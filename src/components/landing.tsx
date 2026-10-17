import { existsSync } from "node:fs";
import path from "node:path";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Download, Film, FolderOpen, Music, Play, Type } from "lucide-react";
import { CHARACTERS, characterById } from "@/lib/characters";
import { PlanCards } from "@/components/plan-cards";
import { StickyCta } from "@/components/sticky-cta";
import { LoopVideo } from "@/components/loop-video";
import { HookDemoExplainer } from "@/components/hook-demo-explainer";

/** A character's landing clip, if one was dropped in public/landing/<id>.mp4 (short, muted, 480p); else its photo shows. */
const clipFor = (id: string) => (existsSync(path.join(process.cwd(), "public", "landing", `${id}.mp4`)) ? `/landing/${id}.mp4` : null);

/*
 * Videos: the most-viewed hook + demo videos in the hook library (other creators'), as light silent loops in
 * public/landing/lib-<code>.mp4 (made by a local script). LOCALHOST ONLY: replace them, or get the creators'
 * permission, before this page is public.
 */

/** The three hero phones play these whole. */
const HERO = [{ lib: "DdLjyNctVi9", views: "3.6M" }, { lib: "DcOiTp0xxTK", views: "5.6M" }, { lib: "DbHo7QFIvD4", views: "3.3M" }];

/** The explainer plays this one whole; its hook ends at the first cut. */
const EXPLAIN = { code: "Dd--YQOqo16", hookEnd: 5.93, length: 20 };
/** The moving strip. */
const LIB_STRIP: [code: string, views: string][] = [
  ["DZAiMMTP2YQ", "4.9M"], ["DdCqlaoP67w", "4.8M"], ["DdXIV6tuGTu", "4.1M"],
  ["Da9dDfqC3a2", "3.4M"], ["Db6BVR0T_-L", "8.9M"], ["DbtW-sFSSlP", "5.1M"], ["DZQq5b8y5-X", "2.7M"], ["DduKGOJTDgx", "2.6M"],
];

/** The 10 x 10 grid: hooks across (one character each), product demos down. */
const HOOK_FACES = ["olivia", "zuri", "jake", "mei", "marcus", "ava", "kenji", "amara", "liam", "freya"];
const DEMOS = [
  { name: "Candle", color: "#f4b860" },
  { name: "Skincare", color: "#f2a7b8" },
  { name: "App", color: "#7b4cfa" },
  { name: "Course", color: "#2a5bd7" },
  { name: "Coffee", color: "#8a5a3c" },
  { name: "Sneakers", color: "#22a06b" },
  { name: "Jewelry", color: "#c9a227" },
  { name: "Plant", color: "#4caf50" },
  { name: "Notebook", color: "#b02f86" },
  { name: "Headphones", color: "#15121f" },
];

const FAQ = [
  { q: "Do I need to be on camera?", a: "No. Pick one of 70 AI characters, or use your own photo." },
  { q: "Where do the hooks come from?", a: "A library of short-form videos that already went viral. You copy the format, your character performs it, and the words are yours." },
  { q: "Can I use the songs?", a: "Songs are 30 second previews. For the full track, upload your own or pick the song in Instagram or TikTok when you post." },
  { q: "Which platforms?", a: "Anything vertical: Instagram Reels, TikTok and YouTube Shorts." },
  { q: "Who owns the videos?", a: "You do. Download them and post them anywhere." },
  { q: "Can I cancel anytime?", a: "Yes, from Billing. Your plan runs until the end of the month you paid for." },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-[15px] font-black text-white">M</span>
      <span className="text-[18px] font-bold tracking-tight">Mavya</span>
    </Link>
  );
}

/** A phone playing a video from the library (whole), or an AI character with a hook caption on top. */
function Phone({ id, text, lib, views, className = "" }: { id?: string; text?: string; lib?: string; views?: string; className?: string }) {
  const c = id ? characterById(id) : null;
  return (
    <div className={`relative w-[200px] shrink-0 rounded-[34px] bg-ink p-[6px] shadow-[0_30px_60px_-24px_rgba(21,18,31,0.55)] ${className}`}>
      <div className="relative aspect-[9/19.5] overflow-hidden rounded-[28px] bg-[#14121f]">
        {lib ? (
          <LoopVideo src={`/landing/lib-${lib}.mp4`} poster={`/landing/lib-${lib}.jpg`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          c && id && (clipFor(id) ? <LoopVideo src={clipFor(id) ?? ""} poster={c.src} className="absolute inset-0 h-full w-full object-cover" /> : <Image src={c.src} alt="" fill sizes="200px" className="object-cover" />)
        )}
        <span className="absolute left-1/2 top-2.5 h-4 w-16 -translate-x-1/2 rounded-full bg-black" />
        {text && (
          <p className="absolute inset-x-3 top-[17%] text-center font-[family-name:var(--font-montserrat)] text-[17px] font-black leading-tight text-white [-webkit-text-stroke:4px_#000] [paint-order:stroke_fill]">
            {text}
          </p>
        )}
        <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-bold text-white">
          <Play className="h-2.5 w-2.5" fill="currentColor" />
          {views ? `${views} views` : "Hook"}
        </span>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 z-30 px-3 pt-3">
        <div className="mx-auto flex max-w-[1160px] items-center gap-6 rounded-2xl border border-line bg-panel/90 px-5 py-2.5 shadow-[0_8px_30px_-12px_rgba(21,18,31,0.18)] backdrop-blur">
          <Logo />
          <nav className="ml-4 hidden items-center gap-5 text-[14px] font-semibold text-muted md:flex">
            <a href="#how" className="hover:text-text">How it works</a>
            <a href="#pricing" className="hover:text-text">Pricing</a>
            <a href="#faq" className="hover:text-text">FAQ</a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/studio" className="text-[14px] font-semibold text-muted hover:text-text">
              Log in
            </Link>
            <Link href="/studio" className="btn-primary px-4 py-2 text-[14px]">
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-[1160px] items-center gap-12 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
        <div>
          <h1 className="text-[44px] font-black leading-[1.02] tracking-[-0.04em] sm:text-[60px]">
            Steal hooks that already went viral.
            <span className="mt-1 block text-accent">Make 100 videos a day.</span>
          </h1>
          <p className="mt-6 max-w-[520px] text-[18px] leading-relaxed text-muted">
            The format that gets SaaS and apps signups on TikTok and Reels: a short hook that stops the scroll, then a demo of your product. Mavya makes the hook, you add the demo.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/studio" className="btn-primary px-6 py-3 text-[16px]">
              Start free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/library" className="flex items-center gap-2 rounded-lg border border-line-strong bg-panel px-5 py-3 text-[15px] font-bold text-text hover:border-ink">
              See the hook library
            </Link>
          </div>
          <p className="mt-4 text-[13.5px] font-semibold text-soft">No credit card. Reels, TikTok and Shorts.</p>
        </div>
        <div className="flex items-center justify-center py-4">
          <Phone {...HERO[0]} className="-mr-14 translate-y-6 -rotate-[8deg] scale-[0.86]" />
          <Phone {...HERO[1]} className="relative z-10" />
          <Phone {...HERO[2]} className="-ml-14 translate-y-6 rotate-[8deg] scale-[0.86]" />
        </div>
      </section>

      {/* What a hook + demo video is, shown with a real one */}
      <section className="mx-auto max-w-[1160px] px-5 pb-20">
        <HookDemoExplainer src={`/landing/lib-${EXPLAIN.code}-full.mp4`} poster={`/landing/lib-${EXPLAIN.code}.jpg`} hookEnd={EXPLAIN.hookEnd} length={EXPLAIN.length} />
      </section>

      {/* More hooks, moving sideways */}
      <div className="overflow-hidden pb-16" aria-hidden>
        <div className="flex w-max animate-[marquee_60s_linear_infinite] gap-4 hover:[animation-play-state:paused]">
          {[...LIB_STRIP, ...LIB_STRIP].map(([code, views], i) => (
            <div key={i} className={`relative aspect-[9/16] w-[160px] shrink-0 overflow-hidden rounded-2xl border border-line bg-raised ${i % 2 ? "rotate-2" : "-rotate-2"}`}>
              <LoopVideo src={`/landing/lib-${code}.mp4`} poster={`/landing/lib-${code}.jpg`} className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white">
                <Play className="h-2.5 w-2.5" fill="currentColor" />
                {views}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* The math */}
      <section className="border-y border-line bg-panel">
        <div className="mx-auto max-w-[1160px] px-5 py-20">
          <div className="grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="text-[36px] font-black leading-[1.05] tracking-[-0.035em] sm:text-[44px]">
                10 hooks × 10 demos
                <span className="block text-accent">= 100 videos</span>
              </h2>
              <p className="mt-5 max-w-[440px] text-[17px] leading-relaxed text-muted">
                Make each hook once. Put it on every product. Every hook, character, demo and song you use is saved, so the next video takes a minute.
              </p>
            </div>
            <div className="overflow-x-auto">
              <div className="inline-grid grid-cols-[74px_repeat(10,minmax(28px,1fr))] gap-1.5">
                <span />
                {HOOK_FACES.map((id) => (
                  <span key={id} className="relative mx-auto h-7 w-7 overflow-hidden rounded-full ring-2 ring-panel">
                    <Image src={characterById(id)?.thumb ?? ""} alt="" fill sizes="28px" className="object-cover" />
                  </span>
                ))}
                {DEMOS.map((d) => (
                  <div key={d.name} className="contents">
                    <span className="flex items-center gap-1.5 truncate pr-1 text-[11.5px] font-bold text-muted">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    {HOOK_FACES.map((id) => (
                      <span key={id} className="relative aspect-[9/16] overflow-hidden rounded-[5px] bg-raised">
                        <Image src={characterById(id)?.thumb ?? ""} alt="" fill sizes="32px" className="object-cover" />
                        <span className="absolute inset-x-0 bottom-0 h-[30%]" style={{ background: d.color }} />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-[1160px] scroll-mt-20 px-5 py-20">
        <h2 className="text-[36px] font-black tracking-[-0.035em] sm:text-[44px]">How it works</h2>
        <div className="mt-10 grid gap-x-8 gap-y-10 rounded-3xl border-2 border-ink bg-panel p-6 shadow-[6px_6px_0_var(--ink)] sm:grid-cols-2 sm:p-8 lg:grid-cols-4">
          <Step n={1} title="Steal a hook" text="Browse hooks that already pulled millions of views.">
            <div className="flex gap-2">
              {["2.1M", "870K", "4.3M"].map((v, i) => (
                <span key={v} className="relative aspect-[9/16] flex-1 overflow-hidden rounded-lg" style={{ background: ["linear-gradient(160deg,#2e1065,#7b4cfa)", "linear-gradient(160deg,#15121f,#2a5bd7)", "linear-gradient(160deg,#5b2fd6,#b02f86)"][i] }}>
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/50 px-1 text-[10px] font-bold text-white">{v}</span>
                </span>
              ))}
            </div>
          </Step>
          <Step n={2} title="Pick your character" text="70 AI characters, or your own photo.">
            <div className="grid grid-cols-4 gap-1.5">
              {CHARACTERS.slice(0, 8).map((c) => (
                <span key={c.id} className="relative aspect-square overflow-hidden rounded-lg">
                  <Image src={c.thumb} alt="" fill sizes="48px" className="object-cover" />
                </span>
              ))}
            </div>
          </Step>
          <Step n={3} title="Add your demo" text="Drop in your product clips. Cut, trim, add text and sound.">
            <div className="space-y-1.5">
              <div className="flex h-7 gap-0.5 overflow-hidden rounded-md">
                <span className="flex w-[38%] items-center gap-1 bg-[#221d33] px-2 text-[10px] font-bold text-white"><Film className="h-3 w-3" />Hook</span>
                <span className="flex flex-1 items-center gap-1 bg-[#d2d0df] px-2 text-[10px] font-bold"><Film className="h-3 w-3" />Demo</span>
              </div>
              <div className="flex h-5 items-center gap-1 rounded-md bg-texttrack-tint px-2 text-[10px] font-semibold text-texttrack" style={{ width: "62%" }}><Type className="h-3 w-3" />Text</div>
              <div className="flex h-6 items-center gap-1 rounded-md bg-soundtrack-tint px-2 text-[10px] font-bold text-soundtrack"><Music className="h-3 w-3" />Trending sound</div>
            </div>
          </Step>
          <Step n={4} title="Export and reuse" text="Download, post, and reuse any part on the next product.">
            <div className="space-y-2">
              <span className="btn-primary w-full py-2 text-[13px]"><Download className="h-3.5 w-3.5" />Export</span>
              <span className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-muted"><FolderOpen className="h-3.5 w-3.5" />Saved to My files</span>
            </div>
          </Step>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-y border-line bg-panel">
        <div className="mx-auto max-w-[1160px] px-5 py-20">
          <h2 className="text-[36px] font-black tracking-[-0.035em] sm:text-[44px]">Pricing</h2>
          <p className="mt-3 text-[17px] text-muted">You pay for AI hooks. Editing and exporting are unlimited on every paid plan.</p>
          <div className="mt-10">
            <PlanCards
              action={(plan) => (
                <Link
                  href="/studio"
                  className={plan.popular ? "btn-primary w-full py-2.5 text-[14px]" : "flex w-full items-center justify-center rounded-lg border border-line-strong py-2.5 text-[14px] font-bold text-text hover:border-ink"}
                >
                  {plan.price ? `Start with ${plan.name}` : "Start free"}
                </Link>
              )}
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-[820px] scroll-mt-20 px-5 py-20">
        <h2 className="text-[36px] font-black tracking-[-0.035em] sm:text-[44px]">Questions</h2>
        <div className="mt-8 divide-y divide-line rounded-2xl border border-line bg-panel">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-bold">
                {f.q}
                <span className="text-[20px] font-medium text-soft transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Last call */}
      <section className="px-5 pb-20">
        <div className="mx-auto flex max-w-[1160px] flex-col items-center rounded-3xl bg-deep px-6 py-16 text-center">
          <h2 className="max-w-[640px] text-[34px] font-black leading-[1.08] tracking-[-0.035em] text-white! sm:text-[44px]">Your next 100 videos start with one hook.</h2>
          <Link href="/studio" className="btn-primary mt-8 px-7 py-3 text-[16px]">
            Start free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <StickyCta />

      <footer className="border-t border-line pb-24">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-4 px-5 py-6 text-[13px] text-soft">
          <Logo />
          <span className="ml-auto">© 2026 Mavya</span>
          <a href="#" className="hover:text-text">Terms</a>
          <a href="#" className="hover:text-text">Privacy</a>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, title, text, children }: { n: number; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="h-[112px]">{children}</div>
      <span className="mt-5 flex h-7 w-7 items-center justify-center rounded-full bg-accent-tint text-[13px] font-extrabold text-accent">{n}</span>
      <h3 className="mt-3 text-[18px] font-extrabold">{title}</h3>
      <p className="mt-1 text-[14.5px] leading-snug text-muted">{text}</p>
    </div>
  );
}
