import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { PlanCards } from "@/components/plan-cards";
import { LoopVideo } from "@/components/loop-video";
import { HookDemoExplainer } from "@/components/hook-demo-explainer";
import { HowItWorks } from "@/components/how-it-works";


/*
 * Videos: the most-viewed hook + demo videos in the hook library (other creators'), as light silent loops in
 * public/landing/lib-<code>.mp4 (made by a local script). LOCALHOST ONLY: replace them, or get the creators'
 * permission, before this page is public.
 */

/** The three hero phones play these whole. */
const HERO = [
  { lib: "DdLjyNctVi9", views: "3.6M" },
  { lib: "DcOiTp0xxTK", views: "5.6M" },
  { lib: "DbHo7QFIvD4", views: "3.3M" },
];

/** A phone playing a library video whole, with its view count. */
function Phone({ lib, views, className = "" }: { lib: string; views: string; className?: string }) {
  return (
    <div className={`relative w-[180px] shrink-0 rounded-[32px] xl:w-[190px] bg-ink p-[6px] shadow-[0_30px_60px_-24px_rgba(21,18,31,0.55)] ${className}`}>
      <div className="relative aspect-[9/19.5] overflow-hidden rounded-[28px] bg-[#14121f]">
        <LoopVideo src={`/landing/lib-${lib}.mp4`} poster={`/landing/lib-${lib}.jpg`} className="absolute inset-0 h-full w-full object-cover" />
        <span className="absolute left-1/2 top-2.5 h-4 w-16 -translate-x-1/2 rounded-full bg-black" />
        <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-bold text-white">
          <Play className="h-2.5 w-2.5" fill="currentColor" />
          {views} views
        </span>
      </div>
    </div>
  );
}

/** The explainer plays this one whole; its hook ends at the first cut. */
const EXPLAIN = { code: "Dd--YQOqo16", hookEnd: 5.93, length: 20 };
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
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-[15px] font-semibold text-white">M</span>
      <span className="text-[18px] font-bold tracking-tight">Mavya</span>
    </Link>
  );
}

export function Landing() {
  return (
    <div className="landing-theme min-h-full bg-bg">
      <header className="sticky top-0 z-30 px-3 pt-3">
        <div className="mx-auto flex max-w-[1160px] items-center gap-6 rounded-xl border border-line bg-panel/85 px-5 py-2.5 shadow-[0_1px_2px_rgba(28,26,23,0.05),0_8px_24px_-12px_rgba(28,26,23,0.12)] backdrop-blur">
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
              Sign up
            </Link>
          </div>
        </div>
      </header>

      {/* Hero: text left (semibold, three clean lines), the three phones fanned right, both in the first screen */}
      <section className="relative overflow-hidden">
        {/* violet glow behind the phones, a little stronger, so the dark card below feels like a continuation */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(46%_58%_at_72%_32%,rgba(123,76,250,0.2)_0%,transparent_100%)]" />
        <div className="relative mx-auto grid max-w-[1160px] items-center gap-12 px-5 pb-24 pt-16 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
          <div>
            <h1 className="text-[38px] font-semibold leading-[1.14] tracking-[-0.035em] sm:text-[48px] lg:text-[46px] xl:text-[48px]">
              <span className="block">AI made building easy.</span>
              <span className="block text-balance text-accent">Mavya makes marketing easy.</span>
            </h1>
            <p className="mt-7 max-w-[480px] text-[17px] leading-relaxed text-muted sm:text-[18.5px]">
              Hook + demo videos are the #1 way to market your app. Create your next viral video in under 2 minutes.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/studio" className="btn-primary h-12 px-7 text-[16px]">
                Sign up
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#pricing" className="inline-flex h-12 items-center justify-center rounded-lg border border-line-strong bg-panel px-7 text-[16px] font-bold text-text transition-colors hover:border-ink">
                Billing
              </a>
            </div>
            <p className="mt-4 text-[13.5px] font-semibold text-soft">Free plan. No card. Reels, TikTok and Shorts.</p>
          </div>
          <div className="flex items-center justify-center py-4">
            <Phone {...HERO[0]} className="-mr-14 translate-y-6 -rotate-[8deg] scale-[0.86]" />
            <Phone {...HERO[1]} className="relative z-10" />
            <Phone {...HERO[2]} className="-ml-14 translate-y-6 rotate-[8deg] scale-[0.86]" />
          </div>
        </div>
      </section>

      {/* What a hook + demo video is, shown with a real one */}
      <section className="mx-auto max-w-[1160px] px-5 pb-20">
        <HookDemoExplainer src={`/landing/lib-${EXPLAIN.code}-full.mp4`} poster={`/landing/lib-${EXPLAIN.code}.jpg`} strip="/landing/explain-strip.jpg" hookEnd={EXPLAIN.hookEnd} length={EXPLAIN.length} />
      </section>

      <HowItWorks />

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-y border-line bg-panel">
        <div className="mx-auto max-w-[1160px] px-5 py-20">
          <h2 className="text-[36px] font-semibold tracking-[-0.035em] sm:text-[44px]">Pricing</h2>
          <p className="mt-3 text-[17px] text-muted">You pay for AI hooks. Editing and exporting are unlimited on every paid plan.</p>
          <div className="mt-10">
            <PlanCards
              quiet
              action={(plan) => (
                <Link
                  href="/studio"
                  className={plan.popular ? "btn-primary h-11 w-full text-[14.5px]" : "flex h-11 w-full items-center justify-center rounded-lg border border-line-strong bg-panel text-[14.5px] font-bold text-text transition-colors hover:border-ink"}
                >
                  {plan.price ? `Start with ${plan.name}` : "Sign up free"}
                </Link>
              )}
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-[820px] scroll-mt-20 px-5 py-20">
        <h2 className="text-[36px] font-semibold tracking-[-0.035em] sm:text-[44px]">Questions</h2>
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
        <div className="relative mx-auto flex max-w-[1160px] flex-col items-center overflow-hidden rounded-[28px] bg-[#15121f] px-6 py-20 text-center">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[460px] w-[760px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,rgba(123,76,250,0.38),transparent)]" />
          <h2 className="relative max-w-[640px] text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-white! sm:text-[44px]">Start with a hook that already went viral.</h2>
          <Link href="/studio" className="btn-primary relative mt-8 h-12 px-7 text-[16px]">
            Sign up
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

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
