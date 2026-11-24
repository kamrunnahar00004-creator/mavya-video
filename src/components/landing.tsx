import Link from "@/components/pending-link";
import { ArrowRight, Play } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { LoopVideo } from "@/components/loop-video";
import { HookDemoExplainer } from "@/components/hook-demo-explainer";
import { HowItWorks } from "@/components/how-it-works";


/*
 * Videos: the most-viewed hook + demo videos in the hook library (other creators'), as light silent loops in
 * public/landing/lib-<code>.mp4 (made by a local script). LOCALHOST ONLY: replace them, or get the creators'
 * permission, before this page is public.
 */

/** The three hero phones play these whole. */
/** Hero before/after: a library reel that went viral, and the founder's reel that copies its hook (Kling 4.0), both whole. */
const BEFORE = { src: "/landing/lib-Dd--YQOqo16-full.mp4", poster: "/landing/lib-Dd--YQOqo16.webp" };
const AFTER = { src: "/landing/ba-after.mp4", poster: "/landing/ba-after.webp" };

/** A phone playing a whole reel on loop: dark frame, side buttons, camera island. */
function Phone({ src, poster, highlight = false }: { src: string; poster: string; highlight?: boolean }) {
  return (
    <div className={`keep-round relative w-[36vw] max-w-[150px] shrink-0 rounded-[30px] bg-[#0b0910] p-[5px] shadow-[0_40px_70px_-28px_rgba(21,18,31,0.6)] sm:w-[210px] sm:max-w-none sm:rounded-[40px] sm:p-[7px] ${highlight ? "ring-4 ring-accent/25" : "ring-1 ring-black/10"}`}>
      <span aria-hidden className="absolute -left-[3px] top-[22%] h-8 w-[3px] rounded-l-full bg-[#0b0910] sm:h-10" />
      <span aria-hidden className="absolute -left-[3px] top-[34%] h-8 w-[3px] rounded-l-full bg-[#0b0910] sm:h-10" />
      <span aria-hidden className="absolute -right-[3px] top-[28%] h-12 w-[3px] rounded-r-full bg-[#0b0910] sm:h-16" />
      <div className="keep-round relative aspect-[9/16] overflow-hidden rounded-[25px] bg-black sm:rounded-[33px]">
        <LoopVideo src={src} poster={poster} className="absolute inset-0 h-full w-full object-cover" />
        <span aria-hidden className="keep-round absolute left-1/2 top-2 h-[14px] w-[52px] -translate-x-1/2 rounded-full bg-black sm:top-2.5 sm:h-[18px] sm:w-[66px]" />
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

export function Landing() {
  return (
    <div className="landing-theme min-h-full bg-bg">
      <link rel="preload" as="image" href="/landing/lib-Dd--YQOqo16.webp" fetchPriority="high" />
      <link rel="preload" as="image" href="/landing/ba-after.webp" fetchPriority="high" />
      <MarketingHeader />

      {/* Hero: text left, a before/after right (a viral reel and the same hook made in Mavya), both in the first screen */}
      <section className="relative overflow-hidden">
        {/* blue glow behind the phones, a little stronger, so the dark card below feels like a continuation */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(46%_58%_at_72%_32%,rgba(74,168,224,0.2)_0%,transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent,black_180px)]" />
        <div className="relative mx-auto grid max-w-[1160px] items-center gap-12 px-5 pb-24 pt-16 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
          <div>
            <h1 className="text-[40px] font-semibold leading-[1.12] tracking-[-0.02em] sm:text-[48px]">
              <span className="block">Turn your app demo</span>
              <span className="block text-balance text-accent">into a viral reel</span>
            </h1>
            <p className="mt-7 max-w-[480px] text-[18px] leading-relaxed text-muted">
              Pick a viral video. Add your app. Your reel is ready in under 2 minutes.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/studio" className="btn-primary h-12 px-7 text-[16px]">
                Sign up
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/pricing" className="inline-flex h-12 items-center justify-center rounded-lg border border-line-strong bg-panel px-7 text-[16px] font-bold text-text transition-colors hover:border-ink">
                Billing
              </Link>
            </div>
            <p className="mt-4 text-[13.5px] font-semibold text-soft">For Reels, TikTok and Shorts.</p>
          </div>
          <div role="group" aria-label="Before and after: a viral video with 5M views, and the same hook made with Mavya" className="flex items-start justify-center gap-3 py-4 sm:gap-6">
            <figure className="flex flex-col items-center gap-4">
              <Phone {...BEFORE} />
              <figcaption className="keep-round flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] font-bold text-muted shadow-sm sm:text-[13px]">
                <Play className="h-3 w-3" fill="currentColor" />
                Viral video, 5M views
              </figcaption>
            </figure>
            <div aria-hidden className="keep-round mt-[115px] flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel text-accent shadow-[0_8px_20px_-8px_rgba(21,18,31,0.35)] ring-1 ring-line sm:mt-[165px] sm:h-11 sm:w-11">
              <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <figure className="flex flex-col items-center gap-4">
              <Phone {...AFTER} highlight />
              <figcaption className="keep-round flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[12px] font-bold text-white shadow-sm sm:text-[13px]">
                Made with Mavya
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* What a hook + demo video is, shown with a real one */}
      <section className="mx-auto max-w-[1160px] px-5 pb-20">
        <HookDemoExplainer src={`/landing/lib-${EXPLAIN.code}-full.mp4`} poster={`/landing/lib-${EXPLAIN.code}.webp`} strip="/landing/explain-strip.webp" hookEnd={EXPLAIN.hookEnd} length={EXPLAIN.length} />
      </section>

      <HowItWorks />

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-[820px] scroll-mt-20 px-5 py-20">
        <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">Questions</h2>
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
        <div className="relative mx-auto flex max-w-[1120px] flex-col items-center overflow-hidden rounded-[28px] bg-[#1c2633] px-6 py-20 text-center">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[460px] w-[760px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,rgba(74,168,224,0.38),transparent)]" />
          <h2 className="relative max-w-[640px] text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px] text-white!">Start with a hook that already went viral.</h2>
          <Link href="/studio" className="btn-primary relative mt-8 h-12 px-7 text-[16px]">
            Sign up
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
