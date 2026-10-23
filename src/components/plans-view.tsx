"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { ContactDialog } from "@/components/contact-dialog";
import { PlanCards } from "@/components/plan-cards";
import { BTN_OUTLINE, SettingsPage, billingAction, useAccount, useToast } from "@/components/settings-shell";
import { BUSINESS, type BillingCycle, type Plan } from "@/lib/plans";

/**
 * Settings > Plans: monthly / yearly switch, the plan cards with Business last, and a link to the full comparison.
 * No plan: a card's button opens Stripe Checkout. With a plan: it switches the subscription (prorated) after a confirm.
 */
export function PlansView() {
  const router = useRouter();
  const { billing, plan: current, loaded, error, reload } = useAccount({ billing: true });
  const currentCycle = billing?.subscription?.cycle ?? "monthly";
  const [cycle, setCycle] = useState<BillingCycle | null>(null);
  const shown = cycle ?? currentCycle;
  const [toast, setToast] = useToast();
  const [contact, setContact] = useState(false);
  const [confirm, setConfirm] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const closeContact = useCallback(() => setContact(false), []);
  const yearly = shown === "annual";

  const choose = async (p: Plan) => {
    setBusy(p.id);
    const error = await billingAction(current ? "change" : "checkout", { plan: p.id, cycle: shown });
    if (error) {
      setToast(error);
      setBusy(null);
      return;
    }
    if (current) {
      await reload();
      setBusy(null);
      router.push("/settings/billing");
    }
    // Checkout: the page is leaving for Stripe, so the button stays busy.
  };

  if(error)return <SettingsPage title="Plans" subtitle="Choose your plan"><p>Plans are unavailable.</p><button className={BTN_OUTLINE} onClick={()=>void reload()}>Retry</button></SettingsPage>;
  const toggle = (
    <div className="text-right">
      <div className="flex items-center gap-3 text-[14px] font-semibold">
        <span className={yearly ? "text-muted" : ""}>Billed monthly</span>
        <button
          type="button"
          role="switch"
          aria-checked={yearly}
          aria-label="Billed yearly"
          onClick={() => setCycle(yearly ? "monthly" : "annual")}
          className={`relative h-6 w-11 rounded-full transition-colors ${yearly ? "bg-accent" : "bg-line-strong"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${yearly ? "left-[22px]" : "left-0.5"}`} />
        </button>
        <span className={yearly ? "" : "text-muted"}>Billed yearly</span>
      </div>
      <p className="mt-1 text-[13px] font-semibold text-accent">2 months free with yearly billing</p>
    </div>
  );

  const label = (p: Plan) => {
    if (!current) return `Choose ${p.name}`;
    if (p.id === current.id) return shown === "annual" ? "Switch to yearly" : "Switch to monthly";
    return p.price > current.price ? "Upgrade" : "Downgrade";
  };

  return (
    <SettingsPage title="Plans" subtitle="Choose the plan that best fits your needs" wide aside={toggle}>
      <div className="mt-8">
        <PlanCards
          current={current?.id}
          cycle={shown}
          action={(p) =>
            p.id === current?.id && shown === currentCycle ? (
              <span className="flex w-full items-center justify-center rounded-lg border border-line py-2.5 text-[14px] font-bold text-soft">Current plan</span>
            ) : (
              <button
                type="button"
                disabled={!loaded || busy !== null}
                onClick={() => (current ? setConfirm(p) : void choose(p))}
                className={`${p.popular ? "btn-primary w-full py-2.5 text-[14px]" : "flex w-full items-center justify-center rounded-lg border border-line-strong py-2.5 text-[14px] font-bold text-text hover:border-ink"} disabled:opacity-60`}
              >
                {busy === p.id ? "Opening..." : label(p)}
              </button>
            )
          }
          extra={
            <div className="flex flex-col rounded-2xl bg-[#15121f] p-6 text-white">
              <h3 className="text-[18px] font-bold text-white!">{BUSINESS.name}</h3>
              <p className="mt-4 text-[30px] font-semibold leading-none tracking-[-0.03em]">{BUSINESS.price}</p>
              <p className="mt-2 text-[13.5px] text-white/65">Minimum applies</p>
              <button type="button" onClick={() => setContact(true)} className="mt-5 flex w-full items-center justify-center rounded-lg bg-white py-2.5 text-[14px] font-bold text-[#15121f] hover:bg-white/90">
                Contact us
              </button>
              <div className="mt-6 border-t border-white/10 pt-5">
                <p className="text-[13px] font-semibold text-white/65">Everything in Studio, plus:</p>
                <ul className="mt-3 space-y-2.5">
                  {BUSINESS.features.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[14px] leading-snug text-white/90">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#b69cff]" strokeWidth={2.6} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          }
        />
      </div>
      <p className="mt-6 text-[13.5px] text-muted">
        <Link href="/pricing#compare-h" className="font-semibold text-accent hover:underline">Compare all features</Link>
      </p>

      {confirm && current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15121f]/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="change-title" className="w-full max-w-[420px] rounded-2xl bg-panel p-6 shadow-[0_24px_64px_-16px_rgba(21,18,31,0.45)]">
            <h2 id="change-title" className="text-[19px] font-bold">Switch to {confirm.name}?</h2>
            <p className="mt-2 text-[14px] text-muted">
              {shown === "annual" ? `$${confirm.yearly} a year` : `$${confirm.price} a month`}. Upgrades are charged now. Other changes start at renewal.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className={BTN_OUTLINE}>
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  const p = confirm;
                  setConfirm(null);
                  void choose(p);
                }}
                className="btn-primary px-4 py-2 text-[14px]"
              >
                Switch plan
              </button>
            </div>
          </div>
        </div>
      )}
      <ContactDialog open={contact} onClose={closeContact} />
      {toast}
    </SettingsPage>
  );
}
