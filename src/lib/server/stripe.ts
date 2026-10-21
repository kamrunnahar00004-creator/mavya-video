import "server-only";
import Stripe from "stripe";
import type { BillingCycle, PlanId } from "@/lib/plans";

/**
 * Stripe, server only. The prices are the ones mavya.app already had (same amounts: $29 / $59 / $99 a month,
 * $290 / $590 / $990 a year), in the existing Vercel variables: STARTER -> Starter, SHOP -> Pro, POWER -> Studio.
 */
export const stripeEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY));
}

const ENV_NAME: Record<PlanId, string> = { starter: "STARTER", pro: "SHOP", studio: "POWER" };
const CYCLE_NAME: Record<BillingCycle, string> = { monthly: "MONTHLY", annual: "ANNUAL" };

export function priceFor(plan: PlanId, cycle: BillingCycle): string {
  const price = process.env[`STRIPE_PRICE_${ENV_NAME[plan]}_${CYCLE_NAME[cycle]}`];
  if (!price) throw new Error(`No Stripe price for ${plan} ${cycle}`);
  return price;
}

/** Which plan and cycle a Stripe price is (null for a price that is not one of ours). */
export function planOfPrice(priceId: string | null | undefined): { plan: PlanId; cycle: BillingCycle } | null {
  if (!priceId) return null;
  for (const plan of Object.keys(ENV_NAME) as PlanId[]) {
    for (const cycle of Object.keys(CYCLE_NAME) as BillingCycle[]) {
      if (process.env[`STRIPE_PRICE_${ENV_NAME[plan]}_${CYCLE_NAME[cycle]}`] === priceId) return { plan, cycle };
    }
  }
  return null;
}

/** Billing period bounds: newer Stripe API versions keep them on the subscription item. */
export function subscriptionPeriod(sub: Stripe.Subscription): { start: string | null; end: string | null } {
  const s = sub as unknown as { current_period_start?: number; current_period_end?: number; items?: { data?: { current_period_start?: number; current_period_end?: number }[] } };
  const item = s.items?.data?.[0];
  const start = s.current_period_start ?? item?.current_period_start;
  const end = s.current_period_end ?? item?.current_period_end;
  return { start: typeof start === "number" ? new Date(start * 1000).toISOString() : null, end: typeof end === "number" ? new Date(end * 1000).toISOString() : null };
}

/**
 * Whether the subscription is set to end. Stripe marks this two ways: cancel_at_period_end, or (newer API versions,
 * and every cancel from the Customer portal) cancel_at with cancel_at_period_end false. Reading only the first kept
 * cancelled subscriptions showing "Renews" in the Etsy app (bug fixed 2026-10-01).
 */
export function subscriptionCancellation(sub: Stripe.Subscription): { cancelling: boolean; endsAt: string | null } {
  const cancelAt = (sub as unknown as { cancel_at?: number | null }).cancel_at;
  const hasCancelAt = typeof cancelAt === "number" && cancelAt > 0;
  return { cancelling: Boolean(sub.cancel_at_period_end) || hasCancelAt, endsAt: hasCancelAt ? new Date(cancelAt * 1000).toISOString() : null };
}

/** The `subscriptions` row for a Stripe subscription. */
export function subscriptionRow(userId: string, sub: Stripe.Subscription, eventCreated: number) {
  const period = subscriptionPeriod(sub);
  const cancel = subscriptionCancellation(sub);
  // A cancel date before the period end is when access really stops.
  if (cancel.endsAt && period.end && cancel.endsAt < period.end) period.end = cancel.endsAt;
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const ours = planOfPrice(priceId);
  return {
    user_id: userId,
    plan: ours?.plan ?? null,
    cycle: ours?.cycle ?? null,
    status: sub.status,
    price_id: priceId,
    current_period_start: period.start,
    current_period_end: period.end,
    cancel_at_period_end: cancel.cancelling,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    last_event_created: eventCreated,
    updated_at: new Date().toISOString(),
  };
}
