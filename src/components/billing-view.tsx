"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CreditCard, Mail } from "lucide-react";
import { ContactDialog } from "@/components/contact-dialog";
import { PlanCards } from "@/components/plan-cards";
import { SettingsHeader } from "@/components/settings-header";
import { BUSINESS, PLANS, planById, type BillingCycle, type PlanId } from "@/lib/plans";
import type { Run } from "@/lib/types";

/**
 * Settings > Billing: the plan with its status, this month's use, Upgrade and Cancel plan; the card on file and
 * invoices; then the plans and support. Cancel, Update card and invoice downloads will go to Stripe (subscription
 * cancel at period end, the customer portal, hosted invoice PDFs).
 * Accounts and Stripe are not connected yet: nobody has a plan. `?plan=pro` (or starter / studio) previews the
 * page as a paying customer.
 */
export function BillingView() {
  const preview = useSearchParams().get("plan");
  const current: PlanId | null = PLANS.some((p) => p.id === preview) ? (preview as PlanId) : null;
  const plan = current ? planById(current) : null;
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [used, setUsed] = useState<{ hooks: number; exports: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [contact, setContact] = useState(false);
  const closeContact = useCallback(() => setContact(false), []);

  // This month's use, counted from the saved videos (generated hooks, including older versions, and exports).
  useEffect(() => {
    let alive = true;
    fetch("/api/runs")
      .then((r) => r.json() as Promise<Run[]>)
      .then((runs) => {
        if (!alive) return;
        const month = new Date().toISOString().slice(0, 7);
        const thisMonth = (at?: string) => Boolean(at?.startsWith(month));
        const hooks = runs.reduce((n, r) => n + [...(r.hook.versions ?? []), ...(r.hook.generated ? [r.hook.generated] : [])].filter((g) => thisMonth(g.at)).length, 0);
        const exports = runs.reduce((n, r) => n + (r.exports ?? []).filter((x) => thisMonth(x.at)).length, 0);
        setUsed({ hooks, exports });
      })
      .catch(() => alive && setUsed({ hooks: 0, exports: 0 }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const [cancel, setCancel] = useState(false);
  const notConnected = () => setToast("Checkout is not connected yet.");
  const stripeOnly = () => setToast("Stripe is not connected yet.");
  const toPlans = () => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const renews = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  const outline = "inline-flex items-center gap-2 rounded-lg border border-line-strong bg-panel px-4 py-2 text-[14px] font-bold text-text hover:border-ink";

  return (
    <div className="card h-full overflow-y-auto">
      <div className="mx-auto max-w-[1080px] px-6 py-8">
        <SettingsHeader tab="billing" />

        {/* The plan: status, use and the two buttons */}
        <section className="mt-8 overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-[17px] font-bold">{plan ? `${plan.name} plan` : "No plan yet"}</h2>
                <span className={`rounded-md px-2 py-0.5 text-[12px] font-bold ${plan ? "bg-emerald-50 text-emerald-700" : "bg-raised text-muted"}`}>{plan ? "Active" : "Not subscribed"}</span>
              </div>
              <p className="mt-1 text-[14px] text-muted">{plan ? `$${plan.price} a month · Renews on ${renews}` : "Choose a plan to start making AI hooks."}</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {plan ? (
                <button type="button" onClick={toPlans} className={plan.id === "studio" ? outline : "btn-primary px-4 py-2 text-[14px]"}>
                  {plan.id === "studio" ? "Change plan" : "Upgrade"}
                </button>
              ) : (
                <button type="button" onClick={toPlans} className="btn-primary px-4 py-2 text-[14px]">
                  View plans
                </button>
              )}
            </div>
          </div>
          <div className="grid border-t border-line sm:grid-cols-2">
            <Usage label="AI hooks this month" used={used?.hooks} limit={plan ? plan.hooks : 0} />
            <Usage label="Exports this month" used={used?.exports} limit={null} className="border-t border-line sm:border-l sm:border-t-0" />
          </div>
          {plan && (
            <div className="flex items-center justify-between gap-4 border-t border-line bg-raised px-6 py-3">
              <span className="text-[13px] text-muted">Cancel anytime. You keep {plan.name} until {renews}.</span>
              <button type="button" onClick={() => setCancel(true)} className="text-[13.5px] font-bold text-red-700 hover:underline">
                Cancel plan
              </button>
            </div>
          )}
        </section>

        {/* Payment method and invoices (Stripe; until it is connected, shown only in the ?plan= preview) */}
        {plan && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <section className="rounded-2xl border border-line bg-panel px-6 py-5">
              <h2 className="text-[16px] font-bold">Payment method</h2>
              <div className="mt-4 flex items-center gap-3">
                <span className="flex h-9 w-12 items-center justify-center rounded-md border border-line bg-raised text-[11px] font-black tracking-wide text-[#1a1f71]">VISA</span>
                <div>
                  <p className="text-[14px] font-semibold tabular-nums">Visa ending in 4242</p>
                  <p className="text-[13px] text-muted">Expires 08/2028</p>
                </div>
              </div>
              <button type="button" onClick={stripeOnly} className={`${outline} mt-5`}>
                <CreditCard className="h-4 w-4" />
                Update card
              </button>
            </section>
            <section className="rounded-2xl border border-line bg-panel px-6 py-5">
              <h2 className="text-[16px] font-bold">Invoices</h2>
              <table className="mt-3 w-full text-[14px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12.5px] text-soft">
                    <th className="py-2 font-semibold">Date</th>
                    <th className="py-2 font-semibold">Plan</th>
                    <th className="py-2 text-right font-semibold">Amount</th>
                    <th className="py-2 pl-4 font-semibold">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2].map((ago) => (
                    <tr key={ago} className="border-b border-line last:border-0">
                      <td className="py-2.5 tabular-nums">{new Date(new Date().getFullYear(), new Date().getMonth() - ago, 1).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td className="py-2.5 text-muted">{plan.name}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">${plan.price}.00</td>
                      <td className="py-2.5 pl-4"><span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-bold text-emerald-700">Paid</span></td>
                      <td className="py-2.5 text-right">
                        <button type="button" onClick={stripeOnly} className="font-semibold text-accent hover:underline">Download</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {/* Plans */}
        <div id="plans" className="mt-12 flex scroll-mt-6 flex-wrap items-center justify-between gap-4">
          <h2 className="text-[20px] font-extrabold tracking-tight">Plans</h2>
          <div className="flex items-center gap-2.5">
            <div role="radiogroup" aria-label="Billing cycle" className="flex rounded-lg border border-line bg-panel p-1">
              {(["monthly", "annual"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={cycle === c}
                  onClick={() => setCycle(c)}
                  className={`rounded-md px-3.5 py-1.5 text-[13.5px] font-bold ${cycle === c ? "bg-ink text-white" : "text-muted hover:text-text"}`}
                >
                  {c === "monthly" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
            <span className="rounded-md bg-accent-tint px-2 py-1 text-[12px] font-bold text-accent">2 months free</span>
          </div>
        </div>
        <div className="mt-5">
          <PlanCards
            current={current}
            cycle={cycle}
            action={(p) =>
              p.id === current ? (
                <span className="flex w-full items-center justify-center rounded-lg border border-line py-2.5 text-[14px] font-bold text-soft">Current plan</span>
              ) : (
                <button
                  type="button"
                  onClick={notConnected}
                  className={p.popular ? "btn-primary w-full py-2.5 text-[14px]" : "flex w-full items-center justify-center rounded-lg border border-line-strong py-2.5 text-[14px] font-bold text-text hover:border-ink"}
                >
                  {!plan ? `Choose ${p.name}` : p.price > plan.price ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
                </button>
              )
            }
          />
        </div>

        {/* Business */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#15121f] px-6 py-5 text-white">
          <div>
            <p className="text-[16px] font-bold">
              {BUSINESS.name} <span className="ml-1.5 rounded-md bg-white/12 px-2 py-0.5 text-[11.5px] font-semibold text-[#b69cff]">{BUSINESS.line}</span>
            </p>
            <p className="mt-1 text-[14px] text-white/70">We run your short-form for you. Pay for results, minimum applies.</p>
          </div>
          <button type="button" onClick={() => setContact(true)} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-[14px] font-bold text-[#15121f] hover:bg-white/90">
            Contact us <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Support */}
        <section className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-panel px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-tint text-accent">
              <Mail className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[14px] font-semibold">Questions about billing?</p>
              <a href="mailto:hello@mavya.app" className="text-[14px] font-semibold text-accent hover:underline">hello@mavya.app</a>
            </div>
          </div>
          <p className="flex gap-4 text-[13.5px] text-muted">
            <Link href="/terms" className="hover:text-text hover:underline">Terms</Link>
            <Link href="/privacy" className="hover:text-text hover:underline">Privacy</Link>
          </p>
        </section>
      </div>
      <ContactDialog open={contact} onClose={closeContact} />
      {cancel && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15121f]/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setCancel(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="cancel-title" className="w-full max-w-[420px] rounded-2xl bg-panel p-6 shadow-[0_24px_64px_-16px_rgba(21,18,31,0.45)]">
            <h2 id="cancel-title" className="text-[19px] font-bold">Cancel your {plan.name} plan?</h2>
            <p className="mt-2 text-[14px] text-muted">You keep {plan.name} until {renews}. After that you can&apos;t make AI hooks; your videos stay saved.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setCancel(false)} className="btn-primary px-4 py-2 text-[14px]">
                Keep my plan
              </button>
              <button
                type="button"
                onClick={() => {
                  setCancel(false);
                  stripeOnly();
                }}
                className="rounded-lg border border-red-300 px-4 py-2 text-[14px] font-bold text-red-700 hover:bg-red-50"
              >
                Cancel plan
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="fade-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-text px-4 py-2.5 text-[13.5px] font-semibold text-bg shadow-lg">{toast}</div>}
    </div>
  );
}

/** One use meter: "3 of 20", or "Unlimited" / "Not on this plan". */
function Usage({ label, used, limit, className = "" }: { label: string; used?: number; limit: number | null; className?: string }) {
  const n = used ?? 0;
  const pct = limit ? Math.min(100, (n / limit) * 100) : 0;
  return (
    <div className={`flex flex-col px-6 py-5 ${className}`}>
      <span className="text-[13px] font-semibold text-soft">{label}</span>
      <span className="mt-1 text-[24px] font-black tabular-nums tracking-tight">{used === undefined ? "..." : !limit ? n : `${n} of ${limit}`}</span>
      <span className="text-[13.5px] text-muted">{limit === null ? "Unlimited" : limit === 0 ? "Not on this plan" : `${Math.max(0, limit - n)} left`}</span>
      {limit ? (
        <span className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised">
          <span className={`block h-full rounded-full ${pct >= 100 ? "bg-red-600" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </div>
  );
}
