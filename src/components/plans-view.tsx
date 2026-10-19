"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { ContactDialog } from "@/components/contact-dialog";
import { PlanCards } from "@/components/plan-cards";
import { SettingsPage, usePreviewPlan, useToast } from "@/components/settings-shell";
import { BUSINESS, type BillingCycle } from "@/lib/plans";

/** Settings > Plans: monthly / yearly switch, the plan cards with Business last, and a link to the full comparison. */
export function PlansView() {
  const { plan: current } = usePreviewPlan();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [toast, setToast] = useToast();
  const [contact, setContact] = useState(false);
  const closeContact = useCallback(() => setContact(false), []);
  const yearly = cycle === "annual";

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

  return (
    <SettingsPage title="Plans" subtitle="Choose the plan that best fits your needs" wide aside={toggle}>
      <div className="mt-8">
        <PlanCards
          current={current?.id}
          cycle={cycle}
          action={(p) =>
            p.id === current?.id ? (
              <span className="flex w-full items-center justify-center rounded-lg border border-line py-2.5 text-[14px] font-bold text-soft">Current plan</span>
            ) : (
              <button
                type="button"
                onClick={() => setToast("Checkout is not connected yet.")}
                className={p.popular ? "btn-primary w-full py-2.5 text-[14px]" : "flex w-full items-center justify-center rounded-lg border border-line-strong py-2.5 text-[14px] font-bold text-text hover:border-ink"}
              >
                {!current ? `Choose ${p.name}` : p.price > current.price ? "Upgrade" : "Downgrade"}
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
      <ContactDialog open={contact} onClose={closeContact} />
      {toast}
    </SettingsPage>
  );
}
