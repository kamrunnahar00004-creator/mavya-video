import { Check } from "lucide-react";
import { PLANS, money, priceOf, type BillingCycle, type Plan } from "@/lib/plans";

/**
 * Settings > Plans (Alura's layout): one card per plan, "Most popular" on the Pro border, "Current" next to the
 * plan you are on, the price for the chosen cycle, the button, then the features. `extra` adds a last card.
 */
export function PlanCards({ action, current, cycle = "monthly", extra }: { action: (plan: Plan) => React.ReactNode; current?: Plan["id"] | null; cycle?: BillingCycle; extra?: React.ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PLANS.map((plan) => (
        <div key={plan.id} className={`relative flex flex-col rounded-2xl border bg-panel p-6 ${plan.popular ? "border-accent ring-1 ring-accent" : "border-line"}`}>
          {plan.popular && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-2.5 py-0.5 text-[12px] font-bold text-white">Most popular</span>}
          <div className="flex items-center gap-2">
            <h3 className="text-[18px] font-bold">{plan.name}</h3>
            {current === plan.id && <span className="rounded-md border border-line-strong px-2 py-0.5 text-[12px] font-semibold text-muted">Current</span>}
          </div>
          <p className="mt-4 flex items-baseline gap-1">
            <span className="text-[38px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{money(priceOf(plan, cycle))}</span>
            <span className="text-[14px] text-muted">/mo</span>
          </p>
          <p className="mt-2 min-h-[40px] text-[13.5px] text-muted">{cycle === "annual" ? `$${plan.yearly} billed yearly` : plan.line}</p>
          <div className="mt-5">{action(plan)}</div>
          <div className="mt-6 border-t border-line pt-5">
            <p className="text-[13px] font-semibold text-muted">{plan.plus ? `Everything in ${plan.plus}, plus:` : `${plan.name} includes:`}</p>
            <ul className="mt-3 space-y-2.5">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2.5 text-[14px] leading-snug">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2.6} />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
      {extra}
    </div>
  );
}
