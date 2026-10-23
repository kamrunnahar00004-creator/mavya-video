"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ChevronLeft, CreditCard, LayoutList, LogOut, User } from "lucide-react";
import { AUTH_ENABLED, signOut } from "@/lib/profile";
import { planById, type BillingCycle, type Plan, type PlanId } from "@/lib/plans";

/*
 * Settings, laid out like Alura's: its own sidebar (back to the app, then Profile, Plans, Billing, Usage) and on
 * each page a title, one line under it and a rule, then plain cards. The plan, usage, card and invoices come from
 * /api/usage and /api/billing (our `subscriptions` row, written by the Stripe webhook, and Stripe itself).
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
                  href={href}
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

/** One date format on server and browser (a locale default would differ and break hydration). */
export const formatDate = (d: Date | string, month: "long" | "short" = "long") => new Date(d).toLocaleDateString("en-US", { month, day: "numeric", year: "numeric" });

export type Usage = { plan: PlanId | null; admin: boolean; used: number; limit: number | null; resetsAt: string | null };
export type Subscription = { plan: PlanId; cycle: BillingCycle | null; status: string; periodEnd: string | null; cancelAtPeriodEnd: boolean; pendingChange?: { plan: PlanId; cycle: BillingCycle; at: string } | null };
export type Billing = {
  enabled: boolean;
  subscription: Subscription | null;
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  invoices: { id: string; date: string; amount: number; currency: string; status: string; plan: string; pdf: string | null }[];
};

const get = <T,>(url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);

/** The plan with usage (and, with `billing`, the card and invoices). `reload` after a change. */
export function useAccount({ billing: withBilling = false } = {}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const [u, b] = await Promise.all([get<Usage>("/api/usage"), withBilling ? get<Billing>("/api/billing") : null]);
    setUsage(u);
    setBilling(b);
    setLoaded(true);
    return { usage: u, billing: b };
  }, [withBilling]);
  useEffect(() => {
    // Fetch on mount; the setState calls happen after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);
  const plan: Plan | null = usage?.plan ? planById(usage.plan) : billing?.subscription ? planById(billing.subscription.plan) : null;
  return { usage, billing, plan, loaded, reload };
}

/** POST an action to /api/billing; a returned url (Checkout, card page) is opened. Returns an error message or null. */
export async function billingAction(action: string, extra: Record<string, unknown> = {}): Promise<string | null> {
  try {
    const r = await fetch("/api/billing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!r.ok) return j.error ?? "Something went wrong. Try again.";
    if (j.url) window.location.assign(j.url);
    return null;
  } catch {
    return "Something went wrong. Try again.";
  }
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

export const BTN_OUTLINE = "inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong bg-panel px-4 py-2 text-[14px] font-bold text-text hover:border-ink disabled:opacity-50";
export const BTN_DANGER = "inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-panel px-4 py-2 text-[14px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50";
