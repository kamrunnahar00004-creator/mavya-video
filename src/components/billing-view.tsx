"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard, Zap } from "lucide-react";
import { BTN_DANGER, BTN_OUTLINE, SettingsPage, formatDate, renewsOn, usePreviewPlan, useToast } from "@/components/settings-shell";

/**
 * Settings > Billing (Alura's layout): with no plan, one card that leads to Plans. With a plan: the subscription
 * (Change plan, Cancel subscription), the card on file and invoices. Cancel, Update and Download will go to Stripe
 * (cancel at period end, the customer portal, hosted invoice PDFs); until it is connected they show a toast, and the
 * card and invoices are sample data for the ?plan= preview.
 */
export function BillingView() {
  const { plan, q } = usePreviewPlan();
  const [toast, setToast] = useToast();
  const [cancel, setCancel] = useState(false);
  const stripeOnly = () => setToast("Stripe is not connected yet.");
  const renews = renewsOn();
  const card = "mt-6 rounded-2xl border border-line bg-panel";

  return (
    <SettingsPage title="Billing" subtitle="Manage your subscription and payment details">
      {!plan ? (
        <div className={`${card} flex flex-wrap items-center gap-4 p-5`}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-raised">
            <Zap className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold">No subscription yet</p>
            <p className="mt-0.5 text-[13.5px] text-muted">Choose a plan to start making AI hooks.</p>
          </div>
          <Link href="/settings/plans" className={BTN_OUTLINE}>
            View plans
          </Link>
        </div>
      ) : (
        <>
          <section className={card}>
            <div className="flex flex-wrap items-center gap-4 p-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
                <Zap className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[15px] font-bold">
                  {plan.name} plan
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-bold text-emerald-700">Active</span>
                </p>
                <p className="mt-0.5 text-[13.5px] text-muted">${plan.price} a month · Renews on {renews}</p>
              </div>
              <Link href={`/settings/plans${q}`} className={BTN_OUTLINE}>
                Change plan
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t border-line p-5">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">Cancel subscription</p>
                <p className="mt-0.5 text-[13.5px] text-muted">You keep {plan.name} until {renews}.</p>
              </div>
              <button type="button" onClick={() => setCancel(true)} className={BTN_DANGER}>
                Cancel subscription
              </button>
            </div>
          </section>

          <section className={`${card} flex flex-wrap items-center gap-4 p-5`}>
            <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-[12px] font-black tracking-wide text-[#1a1f71]">VISA</span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold">Visa ending in 4242</p>
              <p className="mt-0.5 text-[13.5px] text-muted">Expires 08/2028</p>
            </div>
            <button type="button" onClick={stripeOnly} className={BTN_OUTLINE}>
              <CreditCard className="h-4 w-4" />
              Update
            </button>
          </section>

          <section className={`${card} px-5 pb-2 pt-5`}>
            <h2 className="text-[15px] font-bold">Invoices</h2>
            <table className="mt-2 w-full text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[12.5px] text-soft">
                  <th className="py-2 font-semibold">Date</th>
                  <th className="py-2 font-semibold">Plan</th>
                  <th className="py-2 text-right font-semibold">Amount</th>
                  <th className="py-2 pl-5 font-semibold">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2].map((ago) => (
                  <tr key={ago} className="border-b border-line last:border-0">
                    <td className="py-3 tabular-nums">{formatDate(new Date(new Date().getFullYear(), new Date().getMonth() - ago, 1), "short")}</td>
                    <td className="py-3 text-muted">{plan.name}</td>
                    <td className="py-3 text-right font-semibold tabular-nums">${plan.price}.00</td>
                    <td className="py-3 pl-5"><span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-bold text-emerald-700">Paid</span></td>
                    <td className="py-3 text-right">
                      <button type="button" onClick={stripeOnly} className="font-semibold text-accent hover:underline">Download</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {cancel && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15121f]/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setCancel(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="cancel-title" className="w-full max-w-[420px] rounded-2xl bg-panel p-6 shadow-[0_24px_64px_-16px_rgba(21,18,31,0.45)]">
            <h2 id="cancel-title" className="text-[19px] font-bold">Cancel your {plan.name} plan?</h2>
            <p className="mt-2 text-[14px] text-muted">You keep {plan.name} until {renews}. After that you can&apos;t make AI hooks; your videos stay saved.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setCancel(false)} className="btn-primary px-4 py-2 text-[14px]">
                Keep my plan
              </button>
              <button
                type="button"
                onClick={() => {
                  setCancel(false);
                  stripeOnly();
                }}
                className={BTN_DANGER}
              >
                Cancel subscription
              </button>
            </div>
          </div>
        </div>
      )}
      {toast}
    </SettingsPage>
  );
}
