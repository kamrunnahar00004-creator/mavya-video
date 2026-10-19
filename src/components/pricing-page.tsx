"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Minus, Sparkles } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { PlanCards } from "@/components/plan-cards";
import { BUSINESS, PLANS, planById, type BillingCycle } from "@/lib/plans";

/*
 * The pricing page (2026-10-19): what the same videos cost with separate tools (a receipt that adds up, then
 * Mavya at under a quarter of it), the plans, a full comparison, and billing questions.
 * Competitor prices: lowest commonly listed monthly prices from public pricing roundups, October 2026
 * (Higgsfield, Arcads, CapCut, Epidemic Sound, Virlo, ChatGPT). Re-check before launch; prices change.
 */
const STACK: { job: string; tool: string; price: number }[] = [
  { job: "Viral hook research", tool: "Virlo Starter", price: 49 },
  { job: "Scripts and shot lists", tool: "ChatGPT Plus", price: 20 },
  { job: "AI video for the hook", tool: "Higgsfield Plus", price: 49 },
  { job: "AI creators to star in it", tool: "Arcads Starter", price: 110 },
  { job: "Video editor", tool: "CapCut Pro", price: 19.99 },
  { job: "Music you can post", tool: "Epidemic Sound Creator", price: 17.99 },
];
const STACK_TOTAL = STACK.reduce((t, x) => t + x.price, 0);
const MAVYA = planById("pro");
const usd = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;

/** Every plan, every row: a value, a check, or a dash. */
const COMPARE: { group: string; rows: { label: string; values: (string | boolean)[] }[] }[] = [
  {
    group: "Make videos",
    rows: [
      { label: "AI hooks a month", values: PLANS.map((p) => String(p.hooks)) },
      { label: "Exports", values: PLANS.map(() => "Unlimited") },
      { label: "Viral hook library", values: PLANS.map(() => true) },
      { label: "Shot-by-shot demo scripts", values: PLANS.map(() => true) },
      { label: "Built-in editor", values: PLANS.map(() => true) },
      { label: "Priority generation", values: PLANS.map((p) => p.id !== "starter") },
    ],
  },
  {
    group: "Characters and sound",
    rows: [
      { label: "70 AI characters", values: PLANS.map(() => true) },
      { label: "Your own photo as the character", values: PLANS.map(() => true) },
      { label: "Trending songs and the hook's sound", values: PLANS.map(() => true) },
    ],
  },
  {
    group: "Reuse and support",
    rows: [
      { label: "Every hook, demo and song saved to reuse", values: PLANS.map(() => true) },
      { label: "Several products and brands", values: PLANS.map((p) => p.id === "studio") },
      { label: "Priority support", values: PLANS.map((p) => p.id === "studio") },
    ],
  },
];

const BILLING_FAQ = [
  { q: "What counts as an AI hook?", a: "Each hook Mavya generates with your character. Editing, exporting and reusing a hook you already made are free." },
  { q: "Can I change plans?", a: "Yes, any time from Billing. Upgrades start right away." },
  { q: "Can I cancel?", a: "Yes, any time from Billing. Your plan keeps working until the end of the month you paid for." },
  { q: "Is there a free plan?", a: "No. Every plan includes AI hooks from day one, so you can post your first video the day you sign up." },
  { q: "How does annual billing work?", a: "You pay for the year up front and get two months free. Switch between monthly and yearly any time." },
  { q: "What is Business?", a: "We make the videos for you: hooks for your niche, the demo storyboards, the edit and delivery. Priced per project after a short call." },
];

export function PricingPage() {
  const [cycle, setCycle] = useState<BillingCycle>("annual");
  return (
    <div className="landing-theme min-h-full bg-bg">
      <MarketingHeader active="pricing" />

      {/* Header */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(50%_60%_at_50%_0%,rgba(123,76,250,0.16)_0%,transparent_100%)]" />
        <div className="relative mx-auto max-w-[1160px] px-5 pb-16 pt-20 text-center sm:pt-24">
          <p className="text-[14px] font-semibold text-accent">Pricing</p>
          <h1 className="mx-auto mt-3 max-w-[760px] text-[40px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[56px]">One tool instead of six.</h1>
          <p className="mx-auto mt-5 max-w-[560px] text-[18px] leading-relaxed text-muted">
            Hooks, scripts, AI creators, editing and music, in one place. For less than a quarter of what the separate tools cost.
          </p>
        </div>
      </section>

      {/* The receipt */}
      <section className="mx-auto max-w-[1160px] px-5 pb-24">
        <CostStack />
      </section>

      {/* Plans */}
      <section id="plans" className="scroll-mt-24 border-y border-line bg-panel">
        <div className="mx-auto max-w-[1160px] px-5 py-20">
          <div className="flex flex-col items-center text-center">
            <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">Pick your plan</h2>
            <p className="mt-4 max-w-[520px] text-[18px] leading-relaxed text-muted">You pay for AI hooks. Editing and exporting are unlimited on every plan.</p>
            <div role="radiogroup" aria-label="Billing" className="mt-8 inline-flex rounded-full border border-line bg-raised p-1">
              {(["monthly", "annual"] as const).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={cycle === c} onClick={() => setCycle(c)} className={`cursor-pointer rounded-full px-5 py-2 text-[14px] font-semibold transition-colors ${cycle === c ? "bg-panel text-text shadow-[0_1px_3px_rgba(21,18,31,0.12)]" : "text-muted hover:text-text"}`}>
                  {c === "monthly" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[13.5px] text-muted"><span className="font-semibold text-accent">2 months free</span> on yearly billing</p>
          </div>
          <div className="mt-12">
            <PlanCards
              cycle={cycle}
              action={(plan) => (
                <Link
                  href="/studio"
                  className={plan.popular ? "btn-primary h-11 w-full text-[14.5px]" : "flex h-11 w-full items-center justify-center rounded-lg border border-line-strong bg-panel text-[14.5px] font-bold text-text transition-colors hover:border-ink"}
                >
                  Choose {plan.name}
                </Link>
              )}
            />
          </div>

          {/* Business: done for you */}
          <div className="relative mt-6 grid overflow-hidden rounded-2xl bg-[#15121f] text-white md:grid-cols-[0.9fr_1.1fr]">
            <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(123,76,250,0.4),transparent)]" />
            <div className="relative p-8">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-semibold text-[#b69cff]"><Sparkles className="h-3.5 w-3.5" />{BUSINESS.line}</span>
              <h3 className="mt-4 text-[26px] font-semibold tracking-[-0.02em] text-white!">{BUSINESS.name}</h3>
              <p className="mt-2 max-w-[360px] text-[15.5px] leading-relaxed text-white/70">Don&apos;t want to make them yourself? Our team makes your hook + demo videos, ready to post.</p>
              <p className="mt-6 text-[30px] font-semibold tracking-[-0.02em]">Custom</p>
              <p className="text-[13.5px] text-white/60">Priced per project</p>
              <a href={BUSINESS.contact} className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-[14.5px] font-bold text-[#15121f] transition-colors hover:bg-white/90">
                Book a call
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <div className="relative border-t border-white/10 p-8 md:border-l md:border-t-0">
              <p className="text-[14px] font-semibold text-white/90">Everything in Studio, plus:</p>
              <ul className="mt-4 space-y-3.5">
                {BUSINESS.features.map((f) => (
                  <li key={f} className="flex gap-3 text-[15.5px] text-white/80">
                    <Check className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#b69cff]" strokeWidth={2.6} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Compare */}
      <section className="mx-auto max-w-[1160px] px-5 py-20">
        <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">Compare plans</h2>
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="w-[36%] pb-4 text-[14px] font-semibold text-soft">Feature</th>
                {PLANS.map((p) => (
                  <th key={p.id} className="pb-4 text-center">
                    <span className={`text-[16px] font-semibold ${p.popular ? "text-accent" : "text-text"}`}>{p.name}</span>
                    <span className="mt-0.5 block text-[13px] font-semibold text-soft">${cycle === "annual" ? p.annual : p.price} / month</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((g) => (
                <Fragment key={g.group}>
                  <tr>
                    <td colSpan={PLANS.length + 1} className="pb-2 pt-8 text-[13px] font-semibold text-accent">{g.group}</td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.label} className="border-b border-line">
                      <td className="py-3.5 pr-4 text-[15px] text-text">{r.label}</td>
                      {r.values.map((v, i) => (
                        <td key={i} className={`py-3.5 text-center text-[15px] ${PLANS[i].popular ? "bg-accent-tint/60" : ""}`}>
                          {v === true ? <Check className="mx-auto h-[18px] w-[18px] text-accent" strokeWidth={2.6} /> : v === false ? <Minus className="mx-auto h-4 w-4 text-line-strong" /> : <span className="font-semibold tabular-nums">{v}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Billing questions */}
      <section className="border-t border-line bg-panel">
        <div className="mx-auto grid max-w-[1160px] gap-10 px-5 py-20 lg:grid-cols-[0.8fr_1.2fr]">
          <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">Billing questions</h2>
          <div className="divide-y divide-line rounded-2xl border border-line">
            {BILLING_FAQ.map((f) => (
              <div key={f.q} className="px-6 py-5">
                <p className="text-[16px] font-semibold">{f.q}</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20">
        <div className="relative mx-auto flex max-w-[1120px] flex-col items-center overflow-hidden rounded-[28px] bg-[#15121f] px-6 py-20 text-center">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[460px] w-[760px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,rgba(123,76,250,0.38),transparent)]" />
          <h2 className="relative max-w-[640px] text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-white! sm:text-[44px]">Your first video, today.</h2>
          <Link href="#plans" className="btn-primary relative mt-8 h-12 px-7 text-[16px]">
            See plans
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

/**
 * The receipt: each tool you would otherwise pay for adds up line by line (once, when it scrolls into view),
 * the total is crossed out, and Mavya Pro lands below it with the monthly saving.
 */
function CostStack() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (reduced) {
        setShown(STACK.length + 2);
        return;
      }
      let n = 0;
      const step = () => {
        n += 1;
        setShown(n);
        if (n < STACK.length + 2) timer = window.setTimeout(step, n <= STACK.length ? 260 : 600);
      };
      timer = window.setTimeout(step, 200);
    }, { threshold: 0.35 });
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);
  const running = STACK.slice(0, Math.min(shown, STACK.length)).reduce((t, x) => t + x.price, 0);
  const totalOn = shown > STACK.length;
  const mavyaOn = shown > STACK.length + 1;
  const save = STACK_TOTAL - MAVYA.price;
  return (
    <div ref={ref} className="grid items-center gap-12 lg:grid-cols-[1fr_1fr]">
      <div>
        <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">What the same videos cost without Mavya</h2>
        <p className="mt-5 max-w-[480px] text-[18px] leading-relaxed text-muted">
          A hook + demo video takes six jobs: finding the hook, writing the script, making the hook video, the AI creator, the edit and the music. Most people pay a separate tool for each.
        </p>
        <div className="mt-8 flex items-end gap-6">
          <div>
            <p className="text-[13px] font-semibold text-soft">You save</p>
            <p className="mt-1 text-[44px] font-semibold leading-none tracking-[-0.03em] text-accent tabular-nums">{usd(Math.round(save))}<span className="text-[18px] font-semibold text-soft"> / month</span></p>
          </div>
          <div className="pb-1">
            <p className="text-[13px] font-semibold text-soft">That&apos;s</p>
            <p className="mt-1 text-[20px] font-semibold">{Math.round((save / STACK_TOTAL) * 100)}% less</p>
          </div>
        </div>
      </div>

      {/* the receipt */}
      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute -inset-10 bg-[radial-gradient(50%_50%_at_50%_50%,rgba(123,76,250,0.14)_0%,transparent_100%)]" />
        <div className="relative rounded-2xl border border-line bg-panel p-6 shadow-[0_0_0_1px_rgba(21,18,31,0.03),0_24px_48px_-20px_rgba(21,18,31,0.2),0_60px_120px_-40px_rgba(123,76,250,0.3)] sm:p-8">
          <div className="flex items-center justify-between border-b border-dashed border-line-strong pb-4">
            <span className="text-[15px] font-semibold">Without Mavya</span>
            <span className="text-[13px] text-soft">per month</span>
          </div>
          <ul className="mt-2">
            {STACK.map((x, i) => (
              <li key={x.tool} className={`flex items-center justify-between gap-4 py-2.5 transition-[opacity,transform] duration-300 ${i < shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{x.job}</span>
                  <span className="block text-[13px] text-soft">{x.tool}</span>
                </span>
                <span className="text-[15px] font-semibold tabular-nums">{usd(x.price)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-dashed border-line-strong pt-4">
            <span className="text-[15px] font-semibold">Total</span>
            <span className={`relative text-[26px] font-semibold tabular-nums tracking-[-0.02em] ${totalOn ? "text-muted" : ""}`}>
              {usd(Math.round(running))}
              <span aria-hidden className={`absolute left-[-4px] right-[-4px] top-1/2 h-[3px] origin-left -translate-y-1/2 rounded-full bg-red-500 transition-transform duration-500 ${totalOn ? "scale-x-100" : "scale-x-0"}`} />
            </span>
          </div>
          <div className={`mt-5 flex items-center justify-between rounded-xl bg-accent px-5 py-4 text-white transition-[opacity,transform] duration-500 ${mavyaOn ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}>
            <span>
              <span className="block text-[15px] font-semibold">Mavya {MAVYA.name}</span>
              <span className="block text-[13px] text-white/75">Everything above, in one place</span>
            </span>
            <span className="text-[30px] font-semibold tabular-nums tracking-[-0.02em]">${MAVYA.price}</span>
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-soft">Lowest listed monthly prices of each tool, October 2026. Prices change; check each vendor.</p>
        </div>
      </div>
    </div>
  );
}
