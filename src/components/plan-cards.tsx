import { Check } from "lucide-react";
import { PLANS, money, priceOf, type BillingCycle, type Plan } from "@/lib/plans";

/**
 * The plans side by side (pricing page and Billing), Alura style: price for the chosen billing cycle, the yearly
 * total and saving, the button, then "Everything in X, plus:" and the features. `action` renders each button.
 */
export function PlanCards({ action, current, cycle = "monthly" }: { action: (plan: Plan) => React.ReactNode; current?: Plan["id"] | null; cycle?: BillingCycle }) {
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-line bg-panel md:grid-cols-3">
      {PLANS.map((plan, i) => {
        const price = priceOf(plan, cycle);
        const save = Math.round((1 - plan.yearly / (plan.price * 12)) * 100);
        return (
          <div key={plan.id} className={`relative flex flex-col p-7 ${i > 0 ? "border-t border-line md:border-l md:border-t-0" : ""} ${plan.popular ? "bg-accent-tint/50" : ""}`}>
            {plan.popular && <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-accent" />}
            <div className="flex items-center gap-2">
              <h3 className="text-[18px] font-semibold">{plan.name}</h3>
              {plan.popular && <span className="rounded-full bg-accent px-2 py-0.5 text-[11.5px] font-bold text-white">Most popular</span>}
              {current === plan.id && <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[11.5px] font-bold text-accent">Your plan</span>}
            </div>
            <p className="mt-1 text-[14px] text-muted">{plan.line}</p>
            <div className="mt-6 flex items-baseline gap-1">
              <span className="text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{money(price)}</span>
              <span className="text-[15px] font-semibold text-soft">/ month</span>
            </div>
            <p className="mt-2 h-5 text-[13.5px] text-muted">
              {cycle === "annual" ? (
                <>
                  ${plan.yearly} billed yearly, <span className="font-semibold text-accent">save {save}%</span>
                </>
              ) : (
                "Billed monthly"
              )}
            </p>
            <div className="mt-6">{action(plan)}</div>
            <p className="mt-7 text-[14px] font-semibold">{plan.plus ? `Everything in ${plan.plus}, plus:` : "Includes:"}</p>
            <ul className="mt-3 flex-1 space-y-2.5">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2.5 text-[14.5px] leading-snug text-muted">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2.6} />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
