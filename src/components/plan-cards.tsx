import { Check } from "lucide-react";
import { PLANS, type Plan } from "@/lib/plans";

/**
 * The four plans side by side (landing pricing and Billing). `action` renders each card's button,
 * so the landing page links to sign-up and Billing upgrades.
 */
export function PlanCards({ action, current, quiet = false }: { action: (plan: Plan) => React.ReactNode; current?: Plan["id"]; /** Landing: soft elevation instead of the ink border and hard shadow. */ quiet?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {PLANS.map((plan) => (
        <div
          key={plan.id}
          className={`relative flex flex-col border bg-panel p-5 ${quiet ? "rounded-xl" : "rounded-2xl"} ${plan.popular ? (quiet ? "border-accent shadow-[0_16px_40px_-12px_rgba(28,26,23,0.18),0_3px_8px_rgba(28,26,23,0.06)]" : "border-ink shadow-[4px_4px_0_var(--ink)]") : "border-line"}`}
        >
          {plan.popular && <span className={`absolute -top-3 left-5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold text-white ${quiet ? "bg-accent" : "bg-ink"}`}>Most popular</span>}
          <div className="flex items-center justify-between">
            <h3 className="text-[17px] font-extrabold">{plan.name}</h3>
            {current === plan.id && <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[11.5px] font-bold text-accent">Your plan</span>}
          </div>
          <p className="mt-0.5 text-[13px] text-soft">{plan.line}</p>
          <div className="mt-4 flex items-baseline gap-1">
            <span className={`text-[38px] leading-none tracking-tight ${quiet ? "font-semibold" : "font-black"}`}>${plan.price}</span>
            <span className="text-[13.5px] font-semibold text-soft">/ month</span>
          </div>
          <ul className="mt-5 flex-1 space-y-2.5">
            {plan.features.map((f) => (
              <li key={f} className="flex gap-2 text-[13.5px] leading-snug text-muted">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2.6} />
                {f}
              </li>
            ))}
          </ul>
          <div className="mt-6">{action(plan)}</div>
        </div>
      ))}
    </div>
  );
}
