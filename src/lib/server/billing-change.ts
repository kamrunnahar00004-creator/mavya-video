import "server-only";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { planById, type PlanId, type BillingCycle } from "@/lib/plans";
import { planOfPrice, priceFor, stripe, subscriptionPeriod } from "@/lib/server/stripe";
const idOf = (x: string | { id: string }) => typeof x === "string" ? x : x.id;
export async function clearPendingChange(sub: Stripe.Subscription) {
 if (sub.schedule) await stripe().subscriptionSchedules.release(idOf(sub.schedule), { preserve_cancel_date: false });
}
/** Cycle switches and lower quotas wait for renewal; only a same-cycle upgrade can collect now. */
export async function changeSubscription(sub: Stripe.Subscription, plan: PlanId, cycle: BillingCycle, user: string) {
 const item = sub.items.data[0];
 const old = planOfPrice(item?.price.id);
 if (!old || sub.items.data.length !== 1 || item.quantity !== 1 || sub.status !== "active" || sub.pending_update || sub.pause_collection || sub.collection_method !== "charge_automatically") throw new Error("This subscription needs support to change.");
 const price = priceFor(plan, cycle);
 if (price === item.price.id) { await clearPendingChange(sub); return { sub: await stripe().subscriptions.retrieve(sub.id), scheduled: false }; }
 const deferred = cycle !== old.cycle || planById(plan).hooks < planById(old.plan).hooks;
 if (deferred) {
  const period = subscriptionPeriod(sub);
  const end = period.end ? Date.parse(period.end) / 1000 : 0;
  if (end <= Date.now() / 1000) throw new Error("Billing period needs recovery");
  const schedule = sub.schedule ? await stripe().subscriptionSchedules.retrieve(idOf(sub.schedule)) : await stripe().subscriptionSchedules.create({ from_subscription: sub.id });
  const phase = schedule.phases.find(p => p.start_date === schedule.current_phase?.start_date);
  if (!phase || phase.items.length !== 1 || phase.add_invoice_items.length || phase.trial_end || phase.transfer_data || phase.application_fee_percent || phase.billing_thresholds) throw new Error("This schedule needs support to change.");
  // Retain Stripe's existing discount/tax/payment configuration; never calculate discounts ourselves.
  const common: Omit<Stripe.SubscriptionScheduleUpdateParams.Phase, "items"> = {
   ...(phase.discounts.length ? { discounts: phase.discounts.map(d => d.discount ? { discount: idOf(d.discount) } : d.promotion_code ? { promotion_code: idOf(d.promotion_code) } : { coupon: idOf(d.coupon!) }) } : {}),
   ...(phase.default_tax_rates?.length ? { default_tax_rates: phase.default_tax_rates.map(idOf) } : {}),
   ...(phase.default_payment_method ? { default_payment_method: idOf(phase.default_payment_method) } : {}),
   ...(phase.automatic_tax ? { automatic_tax: { enabled: phase.automatic_tax.enabled } } : {}),
   ...(phase.collection_method ? { collection_method: phase.collection_method } : {}),
   ...(phase.description ? { description: phase.description } : {}),
   metadata: { ...phase.metadata, user_id: user }, proration_behavior: "none",
  };
  await stripe().subscriptionSchedules.update(schedule.id, { end_behavior: "release", proration_behavior: "none", phases: [
   { ...common, start_date: phase.start_date, end_date: end, items: [{ price: item.price.id, quantity: 1 }] },
   { ...common, start_date: end, duration: { interval: cycle === "annual" ? "year" : "month", interval_count: 1 }, billing_cycle_anchor: "phase_start", items: [{ price, quantity: 1 }] },
  ] });
  return { sub, scheduled: true };
 }
 const period = subscriptionPeriod(sub);
 const key = createHash("sha256").update(JSON.stringify([sub.id, period.start, item.price.id, price])).digest("hex");
 const updated = await stripe().subscriptions.update(sub.id, {
  items: [{ id: item.id, price }], proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete",
  cancel_at_period_end: false, cancel_at: "", metadata: { user_id: user },
 }, { idempotencyKey: `mavya-upgrade-${key}` });
 if (updated.status !== "active" || updated.items.data[0]?.price.id !== price) throw new Error("Upgrade payment needs recovery");
 // Payment failure above leaves both the subscription and any pending downgrade untouched.
 await clearPendingChange(updated);
 const fresh = await stripe().subscriptions.retrieve(sub.id);
 if (fresh.status !== "active" || fresh.items.data[0]?.price.id !== price) throw new Error("Upgrade state changed");
 return { sub: fresh, scheduled: false };
}
