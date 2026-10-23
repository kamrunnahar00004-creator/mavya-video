"use client";

import Link from "next/link";
import { BTN_OUTLINE, SettingsPage, formatDate, useAccount } from "@/components/settings-shell";

/** Settings > Usage: this period's AI hooks, a bar that fills against the plan's limit. */
export function UsageView() {
  const { usage, plan, loaded, error, reload } = useAccount();
  const used = usage?.used ?? 0;
  const limit = usage?.limit ?? null;
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const unlimited = Boolean(usage && limit === null);
  return (
    <SettingsPage title="Usage" subtitle={plan && usage?.resetsAt ? `Resets on ${formatDate(usage.resetsAt)}` : "This month"}>
      <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[15px] font-bold">AI video hooks</p>
          <p className="text-[14px] font-semibold tabular-nums text-muted">{error ? "Unavailable" : usage?.billingStatus === "past_due" ? "Payment due" : !loaded ? "..." : unlimited ? `${used} used` : plan ? `${used} / ${limit}` : "No plan"}</p>
        </div>
        <span className="mt-3 block h-2 overflow-hidden rounded-full bg-raised">
          <span className={`block h-full rounded-full ${pct >= 100 ? "bg-red-600" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </span>
        {error && <button className={`${BTN_OUTLINE} mt-4`} onClick={()=>void reload()}>Retry</button>}
        {usage?.billingStatus === "past_due" && <Link href="/settings/billing" className={`${BTN_OUTLINE} mt-4`}>Update payment</Link>}
        {loaded && !error && usage?.billingStatus !== "past_due" && !plan && !unlimited && (
          <Link href="/settings/plans" className={`${BTN_OUTLINE} mt-4`}>
            View plans
          </Link>
        )}
      </div>
    </SettingsPage>
  );
}
