"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, ChevronLeft, CreditCard, LayoutList, LogOut, User } from "lucide-react";
import { AUTH_ENABLED, signOut } from "@/lib/profile";
import { PLANS, type Plan } from "@/lib/plans";
import type { Run } from "@/lib/types";

/*
 * Settings, laid out like Alura's: its own sidebar (back to the app, then Profile, Plans, Billing, Usage) and on
 * each page a title, one line under it and a rule, then plain cards.
 * Accounts and Stripe are not connected yet, so nobody has a plan. `?plan=pro` (or starter / studio) previews every
 * settings page as a paying customer; the settings links keep it.
 */
const GROUPS = [
  { label: "Account", items: [{ href: "/settings", label: "Profile", icon: User }] },
  {
    label: "Subscription",
    items: [
      { href: "/settings/plans", label: "Plans", icon: LayoutList },
      { href: "/settings/billing", label: "Billing", icon: CreditCard },
      { href: "/settings/usage", label: "Usage", icon: BarChart3 },
    ],
  },
];

/** The settings sidebar (replaces the app nav while in Settings). */
export function SettingsNav() {
  const pathname = usePathname();
  const { q } = usePreviewPlan();
  return (
    <div className="flex flex-1 flex-col">
      <Link href="/studio" className="flex items-center gap-1.5 px-2 py-2 text-[16px] font-bold">
        <ChevronLeft className="h-4.5 w-4.5" />
        Settings
      </Link>
      <div className="-mx-3 mt-2 border-t border-line" />
      {GROUPS.map((g) => (
        <div key={g.label} className="mt-5">
          <p className="px-2.5 text-[12.5px] font-semibold text-soft">{g.label}</p>
          <div className="mt-1.5 space-y-0.5">
            {g.items.map(({ href, label, icon: Icon }) => {
              const on = pathname === href;
              return (
                <Link
                  key={href}
                  href={href + q}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-semibold ${on ? "bg-raised text-text" : "text-muted hover:bg-raised hover:text-text"}`}
                >
                  <Icon className="h-[17px] w-[17px]" strokeWidth={on ? 2.3 : 2} />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {AUTH_ENABLED && (
        <button type="button" onClick={() => void signOut()} className="mt-auto flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-semibold text-muted hover:bg-raised hover:text-text">
          <LogOut className="h-[17px] w-[17px]" />
          Sign out
        </button>
      )}
    </div>
  );
}

/** One settings page: title, the line under it, a rule, then the content. `aside` sits right of the title. */
export function SettingsPage({ title, subtitle, wide, aside, children }: { title: string; subtitle: string; wide?: boolean; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card h-full overflow-y-auto">
      <div className={`mx-auto px-6 py-10 ${wide ? "max-w-[1180px]" : "max-w-[760px]"}`}>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
          <div>
            <h1 className="text-[24px] font-extrabold tracking-tight">{title}</h1>
            <p className="mt-1 text-[14.5px] text-muted">{subtitle}</p>
          </div>
          {aside}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The previewed plan (`?plan=`) and the query to keep it on settings links. */
export function usePreviewPlan(): { plan: Plan | null; q: string } {
  const id = useSearchParams().get("plan");
  const plan = PLANS.find((p) => p.id === id) ?? null;
  return { plan, q: plan ? `?plan=${plan.id}` : "" };
}

/** One date format on server and browser (a locale default would differ and break hydration). */
export const formatDate = (d: Date, month: "long" | "short" = "long") => d.toLocaleDateString("en-US", { month, day: "numeric", year: "numeric" });

/** The first of next month, when a monthly plan renews and the month's AI hooks reset. */
export const renewsOn = () => {
  const now = new Date();
  return formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
};

/** This month's use, counted from the saved videos (generated hooks, including older versions, and exports). */
export function useMonthUsage() {
  const [used, setUsed] = useState<{ hooks: number; exports: number } | null>(null);
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
  return used;
}

/** A short message at the bottom of the screen. */
export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? <div className="fade-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-text px-4 py-2.5 text-[13.5px] font-semibold text-bg shadow-lg">{toast}</div> : null;
  return [node, setToast] as const;
}

export const BTN_OUTLINE = "inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong bg-panel px-4 py-2 text-[14px] font-bold text-text hover:border-ink";
export const BTN_DANGER = "inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-panel px-4 py-2 text-[14px] font-bold text-red-700 hover:bg-red-50";
