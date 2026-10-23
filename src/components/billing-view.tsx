"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CreditCard, Zap } from "lucide-react";
import { planById } from "@/lib/plans";
import { BTN_DANGER, BTN_OUTLINE, SettingsPage, billingAction, formatDate, useAccount, useToast } from "@/components/settings-shell";

/**
 * Settings > Billing (Alura's layout): with no plan, one card that leads to Plans. With a plan: the subscription
 * (Change plan, Cancel or Resume), the card on file (Update opens Stripe's card page) and the invoices (Stripe PDFs).
 * Back from Checkout (`?paid=1`) the page waits for the webhook to write the plan.
 */
const money = (amount: number, currency: string) => (currency === "USD" ? `$${amount.toFixed(2)}` : `${amount.toFixed(2)} ${currency}`);
const brandName = (b: string) => ({ visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", jcb: "JCB", diners: "Diners", unionpay: "UnionPay" })[b] ?? b.charAt(0).toUpperCase() + b.slice(1);

export function BillingView() {
  const { billing, plan, loaded, reload } = useAccount({ billing: true });
  const paid = useSearchParams().get("paid") === "1";
  const [toast, setToast] = useToast();
  const [cancel, setCancel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(paid);
  const sub = billing?.subscription ?? null;

  // The webhook usually lands within a few seconds of Checkout.
  useEffect(() => {
    if (!waiting) return;
    if (sub) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWaiting(false);
      return;
    }
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      void reload();
      if (tries >= 15) {
        clearInterval(t);
        setWaiting(false);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [waiting, sub, reload]);

  const run = async (action: string) => {
    setBusy(action);
    const error = await billingAction(action);
    if (error) setToast(error);
    else if (action === "cancel" || action === "resume") {
      await reload();
      setToast(action === "cancel" ? "Your plan will end at the end of this period." : "Your plan will renew.");
    }
    setBusy(null);
  };

  const card = "mt-6 rounded-2xl border border-line bg-panel";
  const ends = sub?.periodEnd ? formatDate(sub.periodEnd) : null;
  const pastDue = sub?.status === "past_due";

  return (
    <SettingsPage title="Billing" subtitle="Manage your subscription and payment details">
      {!loaded || (waiting && !sub) ? (
        <div className={`${card} p-5 text-[14px] text-muted`}>{waiting ? "Confirming your payment..." : "Loading..."}</div>
      ) : !sub || !plan ? (
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
                  {pastDue ? (
                    <span className="rounded-md bg-red-50 px-2 py-0.5 text-[12px] font-bold text-red-700">Payment due</span>
                  ) : sub.cancelAtPeriodEnd ? (
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[12px] font-bold text-amber-800">Ending</span>
                  ) : (
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-bold text-emerald-700">Active</span>
                  )}
                </p>
                <p className="mt-0.5 text-[13.5px] text-muted">
                  {sub.cycle === "annual" ? `$${plan.yearly} a year` : `$${plan.price} a month`}
                  {ends && (sub.cancelAtPeriodEnd ? ` · Ends on ${ends}` : ` · Renews on ${ends}`)}
                </p>
                {sub.pendingChange && <p className="mt-0.5 text-[13.5px] text-muted">{planById(sub.pendingChange.plan).name} ({sub.pendingChange.cycle === "annual" ? "yearly" : "monthly"}) starts on {formatDate(sub.pendingChange.at)}.</p>}
              </div>
              <Link href="/settings/plans" className={BTN_OUTLINE}>
                Change plan
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t border-line p-5">
              {sub.cancelAtPeriodEnd ? (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold">Resume subscription</p>
                    <p className="mt-0.5 text-[13.5px] text-muted">{ends ? `Keep ${plan.name} after ${ends}.` : `Keep ${plan.name}.`}</p>
                  </div>
                  <button type="button" disabled={busy !== null} onClick={() => void run("resume")} className={BTN_OUTLINE}>
                    {busy === "resume" ? "Resuming..." : "Resume"}
                  </button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold">Cancel subscription</p>
                    <p className="mt-0.5 text-[13.5px] text-muted">{ends ? `You keep ${plan.name} until ${ends}.` : `You keep ${plan.name} until the end of this period.`}</p>
                  </div>
                  <button type="button" disabled={busy !== null} onClick={() => setCancel(true)} className={BTN_DANGER}>
                    Cancel subscription
                  </button>
                </>
              )}
            </div>
          </section>

          <section className={`${card} flex flex-wrap items-center gap-4 p-5`}>
            <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg border border-line bg-raised">
              <CreditCard className="h-5 w-5 text-muted" />
            </span>
            <div className="min-w-0 flex-1">
              {billing?.card ? (
                <>
                  <p className="text-[15px] font-bold">
                    {brandName(billing.card.brand)} ending in {billing.card.last4}
                  </p>
                  <p className="mt-0.5 text-[13.5px] text-muted">
                    Expires {String(billing.card.expMonth).padStart(2, "0")}/{billing.card.expYear}
                  </p>
                </>
              ) : (
                <p className="text-[15px] font-bold">Payment method</p>
              )}
            </div>
            <button type="button" disabled={busy !== null} onClick={() => void run("card")} className={BTN_OUTLINE}>
              {busy === "card" ? "Opening..." : "Update"}
            </button>
          </section>

          {billing && billing.invoices.length > 0 && (
            <section className={`${card} overflow-x-auto px-5 pb-2 pt-5`}>
              <h2 className="text-[15px] font-bold">Invoices</h2>
              <table className="mt-2 w-full min-w-[480px] text-[14px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12.5px] text-soft">
                    <th className="py-2 font-semibold">Date</th>
                    <th className="py-2 font-semibold">Description</th>
                    <th className="py-2 text-right font-semibold">Amount</th>
                    <th className="py-2 pl-5 font-semibold">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {billing.invoices.map((i) => (
                    <tr key={i.id} className="border-b border-line last:border-0">
                      <td className="py-3 tabular-nums">{formatDate(i.date, "short")}</td>
                      <td className="max-w-[220px] truncate py-3 text-muted">{i.plan}</td>
                      <td className="py-3 text-right font-semibold tabular-nums">{money(i.amount, i.currency)}</td>
                      <td className="py-3 pl-5">
                        <span className={`rounded-md px-2 py-0.5 text-[12px] font-bold ${i.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-raised text-muted"}`}>{i.status.charAt(0).toUpperCase() + i.status.slice(1)}</span>
                      </td>
                      <td className="py-3 text-right">
                        {i.pdf && (
                          <a href={i.pdf} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
                            Download
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {cancel && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15121f]/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setCancel(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="cancel-title" className="w-full max-w-[420px] rounded-2xl bg-panel p-6 shadow-[0_24px_64px_-16px_rgba(21,18,31,0.45)]">
            <h2 id="cancel-title" className="text-[19px] font-bold">Cancel your {plan.name} plan?</h2>
            <p className="mt-2 text-[14px] text-muted">
              You keep {plan.name} until {ends ?? "the end of this period"}. After that you can&apos;t make AI hooks; your videos stay saved.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setCancel(false)} className="btn-primary px-4 py-2 text-[14px]">
                Keep my plan
              </button>
              <button
                type="button"
                onClick={() => {
                  setCancel(false);
                  void run("cancel");
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
