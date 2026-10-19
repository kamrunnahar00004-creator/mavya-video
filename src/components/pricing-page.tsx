"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Minus, Plus } from "lucide-react";
import { MarketingFooter, MarketingHeader, MavyaMark } from "@/components/marketing-chrome";
import { BUSINESS, PLANS, money, planById, priceOf, type BillingCycle, type Plan } from "@/lib/plans";

/*
 * The pricing page, laid out like the Etsy Mavya /subscribe page (2026-10-19): centered title, Monthly / Yearly
 * toggle, four cards (Starter, Pro, Studio, and Business done for you), then what the same videos cost with
 * separate tools, the compare table and the FAQ. No free plan.
 * Competitor prices: lowest commonly listed monthly prices from public pricing roundups, October 2026
 * (Virlo, ChatGPT, Higgsfield, Arcads, CapCut, Epidemic Sound). Re-check before launch; prices change.
 */
/** Each tool with its site icon (public/landing/logos, saved locally). */
const STACK: { job: string; tool: string; logo: string; price: number }[] = [
  { job: "Viral hook research", tool: "Virlo Starter", logo: "virlo", price: 49 },
  { job: "Scripts and shot lists", tool: "ChatGPT Plus", logo: "chatgpt", price: 20 },
  { job: "AI video for the hook", tool: "Higgsfield Plus", logo: "higgsfield", price: 49 },
  { job: "AI creators to star in it", tool: "Arcads Starter", logo: "arcads", price: 110 },
  { job: "Video editor", tool: "CapCut Pro", logo: "capcut", price: 19.99 },
  { job: "Music you can post", tool: "Epidemic Sound Creator", logo: "epidemic", price: 17.99 },
];
const STACK_TOTAL = STACK.reduce((t, x) => t + x.price, 0);
const MAVYA = planById("pro");
const usd = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;

const COLUMNS = [...PLANS.map((p) => p.name), BUSINESS.name];
const COMPARE: { group: string; rows: { label: string; cells: (string | boolean)[] }[] }[] = [
  {
    group: "Make videos",
    rows: [
      { label: "AI video hooks a month", cells: [...PLANS.map((p) => String(p.hooks)), "Unlimited"] },
      { label: "Text on screen", cells: ["Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
      { label: "Shot-by-shot scripts for your app", cells: ["Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
      { label: "AI characters, or your own face", cells: ["Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
      { label: "Viral hook library", cells: [true, true, true, true] },
      { label: "Edits", cells: ["Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
      { label: "Exports", cells: ["Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
      { label: "Trending songs", cells: [true, true, true, true] },
      { label: "Priority generation", cells: [false, true, true, true] },
    ],
  },
  {
    group: "Our team",
    rows: [
      { label: "Weekly review and feedback", cells: [false, true, true, true] },
      { label: "Weekly hook picks for your app", cells: [false, true, true, true] },
      { label: "Every video reviewed before you post", cells: [false, false, true, true] },
      { label: "1:1 guidance", cells: [false, false, true, true] },
    ],
  },
  {
    group: "Done for you",
    rows: [
      { label: "A dedicated marketing team", cells: [false, false, false, true] },
      { label: "We make, edit and post the videos", cells: [false, false, false, true] },
      { label: "Paid on performance", cells: [false, false, false, true] },
    ],
  },
];

const FAQ = [
  { q: "What counts as an AI hook?", a: "Each hook Mavya generates with your character. Editing, exporting and reusing a hook you already made are free." },
  { q: "Is there a free plan?", a: "No. Every plan includes AI hooks from day one, so you can post your first video the day you sign up." },
  { q: "How does yearly billing work?", a: "You pay for the year up front: $290, $590 or $990, two months free. Switch between monthly and yearly any time." },
  { q: "Can I change plans?", a: "Yes, any time from Billing. Upgrades start right away." },
  { q: "Can I cancel?", a: "Yes, any time from Billing. Your plan keeps working until the end of the period you paid for." },
  { q: "What do the Pro and Studio reviews include?", a: "On Pro, our team reviews your week of videos and sends written feedback and hook picks for your app. On Studio, we review every video before you post it, with notes on the hook, the script and the edit." },
  { q: "How does Business work?", a: "Send us your website. A dedicated team makes and posts your short-form videos against a monthly views quota agreed up front. If we miss the quota, you don't pay for that month. A minimum applies; book a call for details." },
];

const cardBtn = "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-[14.5px] font-semibold transition-colors";

function FeatureList({ lead, items, strong }: { lead?: string; items: string[]; strong?: boolean }) {
  return (
    <div className="mt-6 border-t border-line pt-5">
      {lead && <p className="mb-3 text-[13px] font-semibold">{lead}</p>}
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-[14px] leading-snug">
            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${strong ? "text-accent" : "text-muted"}`} aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanCard({ plan, cycle }: { plan: Plan; cycle: BillingCycle }) {
  const price = priceOf(plan, cycle);
  return (
    <div className={`flex flex-col rounded-2xl bg-panel p-6 ${plan.popular ? "border-2 border-accent shadow-[0_1px_2px_rgba(21,18,31,0.04),0_16px_40px_-16px_rgba(123,76,250,0.35)]" : "border border-line"}`}>
      <span className="flex h-6 items-start">{plan.popular && <span className="rounded-md bg-accent px-2 py-0.5 text-[11.5px] font-semibold text-white">Most popular</span>}</span>
      <p className="text-[17px] font-semibold">{plan.name}</p>
      <p className="mt-1 min-h-[40px] text-[13.5px] text-muted">{plan.line}</p>
      <p className="mt-4 flex items-baseline gap-1">
        <span className="text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{money(price)}</span>
        <span className="text-[14px] text-muted">/ month</span>
      </p>
      <p className="mt-1.5 text-[12.5px] text-soft">{cycle === "annual" ? `$${plan.yearly} billed yearly, save $${plan.price * 12 - plan.yearly}` : "Billed monthly"}</p>
      <Link href="/studio" className={`${cardBtn} mt-5 ${plan.popular ? "bg-accent text-white hover:bg-accent-hover" : "bg-text text-white hover:opacity-90"}`}>
        Choose {plan.name}
      </Link>
      <FeatureList lead={plan.plus ? `Everything in ${plan.plus}, plus:` : "Includes:"} items={plan.features} strong={plan.popular} />
    </div>
  );
}

function BusinessCard() {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl bg-[#15121f] p-6 text-white">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-[260px] w-[260px] rounded-full bg-[radial-gradient(closest-side,rgba(123,76,250,0.45),transparent)]" />
      <span className="relative flex h-6 items-start"><span className="rounded-md bg-white/12 px-2 py-0.5 text-[11.5px] font-semibold text-[#b69cff]">{BUSINESS.line}</span></span>
      <p className="relative text-[17px] font-semibold">{BUSINESS.name}</p>
      <p className="relative mt-1 min-h-[40px] text-[13.5px] text-white/70">We run your short-form for you</p>
      <p className="relative mt-4 text-[30px] font-semibold leading-[1.05] tracking-[-0.03em]">{BUSINESS.price}</p>
      <p className="relative mt-1.5 text-[12.5px] text-white/60">Minimum applies</p>
      <a href={BUSINESS.contact} className={`${cardBtn} relative mt-5 bg-white text-[#15121f] hover:bg-white/90`}>
        Book a call
        <ArrowRight className="h-4 w-4" />
      </a>
      <div className="relative mt-6 border-t border-white/10 pt-5">
        <p className="mb-3 text-[13px] font-semibold">Everything in Studio, plus:</p>
        <ul className="space-y-2.5">
          {BUSINESS.features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-[14px] leading-snug text-white/85">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#b69cff]" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PricingPage() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  return (
    <div className="landing-theme min-h-full bg-bg">
      <MarketingHeader active="pricing" />

      <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-14 sm:pt-20">
        <h1 className="text-center text-[34px] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[44px]">Plans for every creator</h1>
        <p className="mx-auto mt-3 max-w-[52ch] text-center text-[16px] text-muted">Every plan makes AI hooks from day one. Editing and exporting are unlimited.</p>

        {/* Monthly / Yearly */}
        <div className="mt-8 flex items-center justify-center gap-2.5">
          <div role="tablist" aria-label="Billing" className="inline-flex rounded-lg border border-line bg-panel p-1">
            {(["monthly", "annual"] as const).map((c) => (
              <button key={c} type="button" role="tab" aria-selected={cycle === c} onClick={() => setCycle(c)} className={`cursor-pointer rounded-md px-4 py-1.5 text-[13.5px] font-semibold transition-colors ${cycle === c ? "bg-text text-white" : "text-muted hover:text-text"}`}>
                {c === "monthly" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
          <span className="rounded-md bg-accent-tint px-2.5 py-1 text-[12px] font-semibold text-accent">2 months free</span>
        </div>

        {/* The four cards */}
        <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-stretch">
          {PLANS.map((plan) => <PlanCard key={plan.id} plan={plan} cycle={cycle} />)}
          <BusinessCard />
        </div>
        <p className="mt-5 text-center text-[12.5px] text-soft">Plans renew automatically; cancel anytime in Billing.</p>

        {/* One tool instead of six */}
        <section className="mt-24">
          <CostStack />
        </section>

        {/* Compare plans */}
        <section className="mt-24" aria-labelledby="compare-h">
          <h2 id="compare-h" className="text-center text-[28px] font-semibold tracking-[-0.02em]">Compare plans</h2>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-panel">
            <table className="w-full min-w-[760px] text-[14px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="px-5 py-4 font-medium text-muted">Features</th>
                  {COLUMNS.map((name, i) => (
                    <th key={name} scope="col" className={`w-[140px] px-4 py-4 text-center text-[14.5px] font-semibold ${PLANS[i]?.popular ? "text-accent" : ""}`}>{name}</th>
                  ))}
                </tr>
              </thead>
              {COMPARE.map((g) => (
                <tbody key={g.group}>
                  <tr className="bg-raised">
                    <th scope="colgroup" colSpan={COLUMNS.length + 1} className="px-5 py-2.5 text-left text-[13px] font-semibold">{g.group}</th>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.label} className="border-t border-line">
                      <th scope="row" className="px-5 py-3 text-left font-normal">{r.label}</th>
                      {r.cells.map((c, i) => (
                        <td key={i} className="px-4 py-3 text-center tabular-nums">
                          {c === true ? <Check className="mx-auto h-4 w-4 text-accent" aria-label="Included" /> : c === false ? <Minus className="mx-auto h-4 w-4 text-line-strong" aria-label="Not included" /> : c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto mt-24 max-w-[760px]" aria-labelledby="faq-h">
          <p className="text-center text-[13px] font-semibold text-accent">FAQ</p>
          <h2 id="faq-h" className="mt-1.5 text-center text-[28px] font-semibold tracking-[-0.02em]">Have any questions?</h2>
          <div className="mt-7 border-t border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-line">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <Plus className="h-[18px] w-[18px] shrink-0 text-muted transition-transform group-open:rotate-45" aria-hidden />
                </summary>
                <p className="pb-5 pr-8 text-[14.5px] leading-relaxed text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-20 max-w-[620px] text-center">
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Your first video, today</h2>
          <Link href="/studio" className="mx-auto mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-7 text-[14.5px] font-semibold text-white transition-colors hover:bg-accent-hover">
            Sign up
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </main>

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
    <div ref={ref} className="mx-auto max-w-[560px]">
      <h2 className="text-center text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">One tool instead of six.</h2>
      <div className="relative mt-10">
        <div aria-hidden className="pointer-events-none absolute -inset-10 bg-[radial-gradient(50%_50%_at_50%_50%,rgba(123,76,250,0.14)_0%,transparent_100%)]" />
        <div className="relative rounded-2xl border border-line bg-panel p-6 shadow-[0_0_0_1px_rgba(21,18,31,0.03),0_24px_48px_-20px_rgba(21,18,31,0.2),0_60px_120px_-40px_rgba(123,76,250,0.3)] sm:p-8">
          <div className="flex items-center justify-between border-b border-dashed border-line-strong pb-4">
            <span className="text-[15px] font-semibold">Without Mavya</span>
            <span className="text-[13px] text-soft">per month</span>
          </div>
          <ul className="mt-2">
            {STACK.map((x, i) => (
              <li key={x.tool} className={`flex items-center gap-3.5 py-2.5 transition-[opacity,transform] duration-300 ${i < shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/landing/logos/${x.logo}.png`} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-lg border border-line bg-panel object-contain p-1" />
                <span className="min-w-0 flex-1">
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
          <div className={`mt-5 flex items-center gap-4 rounded-xl bg-accent px-5 py-4 text-white transition-[opacity,transform] duration-500 ${mavyaOn ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}>
            <MavyaMark className="h-10 w-10 shrink-0" inverted />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">Mavya {MAVYA.name}</span>
              <span className="block text-[13px] text-white/80">All six, in one place</span>
            </span>
            <span className="text-right">
              <span className="block text-[30px] font-semibold leading-none tabular-nums tracking-[-0.02em]">${MAVYA.price}</span>
              <span className="mt-1 block text-[12.5px] font-semibold text-white/85">{Math.round((save / STACK_TOTAL) * 100)}% less</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
