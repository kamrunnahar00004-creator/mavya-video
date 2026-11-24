import Link from "@/components/pending-link";
import { ArrowRight } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { HookPair } from "@/components/hook-pair";
import { HookDemoExplainer } from "@/components/hook-demo-explainer";
import { HowItWorks } from "@/components/how-it-works";


/*
 * Videos: the most-viewed hook + demo videos in the hook library (other creators'), as light silent loops in
 * public/landing/lib-<code>.mp4 (made by a local script). LOCALHOST ONLY: replace them, or get the creators'
 * permission, before this page is public.
 */

/** The three hero phones play these whole. */
/** Hero before/after: a viral library hook and the same hook made in Mavya (Kling 4.0), equal length so they play in sync. */
const BEFORE = { src: "/landing/ba-before.mp4", poster: "/landing/ba-before.webp", label: "Viral hook, 5M views" };
const AFTER = { src: "/landing/ba-after.mp4", poster: "/landing/ba-after.webp", label: "Made with Mavya", caption: "my app finally got 100 visitors \u{1F62D}" };

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
      <link rel="preload" as="image" href="/landing/ba-before.webp" fetchPriority="high" />
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
          <div role="group" aria-label="Before and after: a viral hook with 5M views, and the same hook made with Mavya" className="flex justify-center py-4">
            <HookPair before={BEFORE} after={AFTER} />
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
