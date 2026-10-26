import "server-only";
import type Stripe from "stripe";
import type { BillingCycle, PlanId } from "@/lib/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { priceFor, stripe, subscriptionRow } from "@/lib/server/stripe";

export type BillingRow = {
  plan: PlanId | null; cycle: BillingCycle | null; status: string | null;
  current_period_end: string | null; cancel_at_period_end: boolean;
  stripe_customer_id: string | null; stripe_subscription_id: string | null;
  last_event_created: number; billing_revision: number;
};
const db = () => createSupabaseAdminClient();
export async function billingRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data as T;
}
export async function billingRow(user: string): Promise<BillingRow | null> {
  const { data, error } = await db().from("subscriptions").select("plan,cycle,status,current_period_end,cancel_at_period_end,stripe_customer_id,stripe_subscription_id,last_event_created,billing_revision").eq("user_id", user).maybeSingle<BillingRow>();
  if (error) throw error;
  return data;
}
export class BillingBusy extends Error {}
export async function withBillingLock<T>(user: string, work: (token: string) => Promise<T>): Promise<T> {
  const token = await billingRpc<string | null>("mavya_billing_lock", { p_user: user });
  if (!token) throw new BillingBusy("Billing is updating. Try again.");
  try { return await work(token); }
  finally {
    try { await billingRpc("mavya_billing_unlock", { p_user: user, p_token: token }); }
    catch (error) { console.error("billing unlock", user, error); }
  }
}
export async function applyBillingAction(user: string, token: string, before: BillingRow, sub: Stripe.Subscription) {
  const applied = await billingRpc<boolean>("mavya_billing_action", {
    p_user: user, p_token: token, p_subscription: before.stripe_subscription_id,
    p_revision: before.billing_revision, p_watermark: before.last_event_created,
    p_state: subscriptionRow(user, sub, before.last_event_created),
  });
  if (!applied) throw new Error("Billing changed. Reload before trying again.");
}

type Pending = { request_key: string; params: Stripe.Checkout.SessionCreateParams; session_id: string | null; created_at: string };
const terminal = (status: string | null) => status === "canceled" || status === "incomplete_expired";
/** Caller holds the account lease. Persist exact request parameters BEFORE an idempotent Stripe create. */
export async function pendingCheckout(user: { id: string; email?: string }, token: string, row: BillingRow | null, plan: PlanId, cycle: BillingCycle, origin: string): Promise<string> {
  if (row?.stripe_subscription_id) {
    if (!terminal(row.status)) throw new BillingBusy("You already have a plan. Change it instead.");
    const current = await stripe().subscriptions.retrieve(row.stripe_subscription_id);
    if (!terminal(current.status)) throw new BillingBusy("Your plan is updating. Try again.");
  }
  const price = priceFor(plan, cycle);
  for (let i = 0; i < 2; i++) {
    const pending = await billingRpc<Pending>("mavya_checkout_prepare", { p_user: user.id, p_token: token, p_params: {
      mode: "subscription", line_items: [{ price, quantity: 1 }], client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id } },
      ...(row?.stripe_customer_id ? { customer: row.stripe_customer_id } : { customer_email: user.email }),
      allow_promotion_codes: true, expires_at: Math.floor(Date.now() / 1000) + 3600,
      // The return page confirms the payment with Stripe itself and opens the app at once (no waiting for the webhook).
      success_url: `${origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/pricing`,
    } });
    let session: Stripe.Checkout.Session;
    if (pending.session_id) session = await stripe().checkout.sessions.retrieve(pending.session_id);
    else {
      // Stripe may prune idempotency keys after 24h. Never replay an unknown create beyond that window.
      if (Date.now() - Date.parse(pending.created_at) > 23 * 3600_000) throw new BillingBusy("Checkout needs recovery. Email hello@mavya.app.");
      session = await stripe().checkout.sessions.create(pending.params, { idempotencyKey: `mavya-checkout-${pending.request_key}` });
    }
    await billingRpc("mavya_checkout_record", { p_user: user.id, p_token: token, p_key: pending.request_key, p_session: session.id, p_status: session.status });
    if (session.status === "expired") {
      await billingRpc("mavya_checkout_clear", { p_user: user.id, p_token: token, p_key: pending.request_key });
      continue;
    }
    const sessionSub = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (session.status === "complete" && row && row.stripe_subscription_id === sessionSub && terminal(row.status)) {
      await billingRpc("mavya_checkout_clear", { p_user: user.id, p_token: token, p_key: pending.request_key, p_subscription: sessionSub });
      continue;
    }
    if (session.status !== "open" || !session.url) throw new BillingBusy("Your payment is updating. Try again.");
    if (pending.params.line_items?.[0]?.price !== price) throw new BillingBusy("Finish your open checkout first.");
    return session.url;
  }
  throw new BillingBusy("Checkout is updating. Try again.");
}
