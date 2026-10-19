"use client";

import Link from "next/link";
import { BTN_OUTLINE, SettingsPage, renewsOn, useMonthUsage, usePreviewPlan } from "@/components/settings-shell";

/** Settings > Usage: this month's AI hooks, a bar that fills against the plan's limit. */
export function UsageView() {
  const { plan } = usePreviewPlan();
  const used = useMonthUsage();
  const hooks = used?.hooks ?? 0;
  const pct = plan ? Math.min(100, (hooks / plan.hooks) * 100) : 0;
  return (
    <SettingsPage title="Usage" subtitle={plan ? `This month, resets on ${renewsOn()}` : "This month"}>
      <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[15px] font-bold">AI video hooks</p>
          <p className="text-[14px] font-semibold tabular-nums text-muted">
            {used === null ? "..." : plan ? `${hooks} / ${plan.hooks}` : "No plan"}
          </p>
        </div>
        <span className="mt-3 block h-2 overflow-hidden rounded-full bg-raised">
          <span className={`block h-full rounded-full ${pct >= 100 ? "bg-red-600" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </span>
        {!plan && (
          <Link href="/settings/plans" className={`${BTN_OUTLINE} mt-4`}>
            View plans
          </Link>
        )}
      </div>
    </SettingsPage>
  );
}
