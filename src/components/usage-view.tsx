"use client";

import Link from "next/link";
import { BTN_OUTLINE, SettingsPage, renewsOn, useMonthUsage, usePreviewPlan } from "@/components/settings-shell";

/** Settings > Usage: this month's AI hooks against the plan, and exports (unlimited). */
export function UsageView() {
  const { plan } = usePreviewPlan();
  const used = useMonthUsage();
  const hooks = used?.hooks ?? 0;
  const pct = plan ? Math.min(100, (hooks / plan.hooks) * 100) : 0;
  const card = "rounded-2xl border border-line bg-panel p-5";
  return (
    <SettingsPage title="Usage" subtitle={plan ? `This month, resets on ${renewsOn()}` : "This month"}>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className={card}>
          <p className="text-[13.5px] font-semibold text-muted">AI video hooks</p>
          <p className="mt-1.5 text-[28px] font-black tabular-nums tracking-tight">
            {used === null ? "..." : plan ? `${hooks} of ${plan.hooks}` : hooks}
          </p>
          {plan ? (
            <>
              <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-raised">
                <span className={`block h-full rounded-full ${pct >= 100 ? "bg-red-600" : "bg-accent"}`} style={{ width: `${pct}%` }} />
              </span>
              <p className="mt-2 text-[13px] text-muted">{Math.max(0, plan.hooks - hooks)} left</p>
            </>
          ) : (
            <Link href="/settings/plans" className={`${BTN_OUTLINE} mt-3`}>
              View plans
            </Link>
          )}
        </div>
        <div className={card}>
          <p className="text-[13.5px] font-semibold text-muted">Exports</p>
          <p className="mt-1.5 text-[28px] font-black tabular-nums tracking-tight">{used === null ? "..." : used.exports}</p>
          <p className="mt-2 text-[13px] text-muted">Unlimited</p>
        </div>
      </div>
    </SettingsPage>
  );
}
