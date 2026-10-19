"use client";

import { useEffect, useState } from "react";
import { CreditCard, Receipt } from "lucide-react";
import { PlanCards } from "@/components/plan-cards";
import { planById, type PlanId } from "@/lib/plans";
import type { Run } from "@/lib/types";

/**
 * Billing: the current plan and this month's use (AI hooks and exports), the plans to switch to, and invoices.
 * Accounts and Stripe are not connected yet: nobody has a plan, and the buttons say so.
 */
export function BillingView() {
  // Accounts and checkout are not connected yet: nobody has a plan.
  const current: PlanId | null = null;
  const plan = current ? planById(current) : null;
  const [used, setUsed] = useState<{ hooks: number; exports: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  const notConnected = () => setToast("Checkout is not connected yet.");

  return (
    <div className="card h-full overflow-y-auto">
      <div className="mx-auto max-w-[1080px] px-6 py-8">
        <h1 className="text-[26px] font-extrabold tracking-tight">Billing</h1>

        {/* Current plan and use */}
        <div className="mt-6 grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
          <div className="flex flex-col rounded-2xl border border-line bg-panel p-5">
            <span className="text-[13px] font-semibold text-soft">Your plan</span>
            <span className="mt-1 text-[24px] font-black tracking-tight">{plan ? plan.name : "No plan yet"}</span>
            <span className="text-[13.5px] text-muted">{plan ? `$${plan.price} / month` : "Pick a plan below to start"}</span>
            <button type="button" onClick={notConnected} disabled={!plan} className="mt-4 flex w-fit items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-bold text-text hover:border-ink disabled:border-line disabled:text-soft">
              <CreditCard className="h-4 w-4" />
              Manage billing
            </button>
          </div>
          <Usage label="AI hooks this month" used={used?.hooks} limit={plan ? plan.hooks : 0} />
          <Usage label="Exports this month" used={used?.exports} limit={null} />
        </div>

        {/* Plans */}
        <h2 className="mt-10 text-[18px] font-extrabold">Plans</h2>
        <div className="mt-4">
          <PlanCards
            current={current}
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

        {/* Invoices */}
        <h2 className="mt-10 text-[18px] font-extrabold">Invoices</h2>
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-5 py-6 text-[14px] text-soft">
          <Receipt className="h-5 w-5" />
          No invoices yet
        </div>
      </div>
      {toast && <div className="fade-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-text px-4 py-2.5 text-[13.5px] font-semibold text-bg shadow-lg">{toast}</div>}
    </div>
  );
}

/** One use meter: "3 of 20", or "Unlimited" / "Not on this plan". */
function Usage({ label, used, limit }: { label: string; used?: number; limit: number | null }) {
  const n = used ?? 0;
  const pct = limit ? Math.min(100, (n / limit) * 100) : 0;
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-panel p-5">
      <span className="text-[13px] font-semibold text-soft">{label}</span>
      <span className="mt-1 text-[24px] font-black tabular-nums tracking-tight">
        {used === undefined ? "..." : !limit ? n : `${n} of ${limit}`}
      </span>
      <span className="text-[13.5px] text-muted">{limit === null ? "Unlimited" : limit === 0 ? "Not on this plan" : `${Math.max(0, limit - n)} left`}</span>
      {limit ? (
        <span className="mt-4 h-1.5 overflow-hidden rounded-full bg-raised">
          <span className={`block h-full rounded-full ${pct >= 100 ? "bg-red-600" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </div>
  );
}
