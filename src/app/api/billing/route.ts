import { connection } from "next/server";
import type Stripe from "stripe";
import { PLANS, type BillingCycle } from "@/lib/plans";
import { planOfPrice, stripe, stripeEnabled } from "@/lib/server/stripe";
import { changeSubscription, clearPendingChange } from "@/lib/server/billing-change";
import { getSessionUser } from "@/lib/supabase/server";
import { applyBillingAction, BillingBusy, billingRow, pendingCheckout, withBillingLock, type BillingRow } from "@/lib/server/billing-state";

export const maxDuration = 120;

/**
 * Settings > Billing and Plans.
 * GET: the plan (from our `subscriptions`, written by the webhook), the card on file and the invoices (from Stripe).
 * POST {action}:
 *   "checkout" {plan, cycle}  -> {url}  Stripe Checkout for a first plan
 *   "change"   {plan, cycle}  -> {ok}   switch plan, prorated (an active subscription)
 *   "cancel"                  -> {ok}   ends at the period end; access stays until then
 *   "resume"                  -> {ok}   undo a cancel before it ends
 *   "card"                    -> {url}  Stripe's page to update the card
 * Webhooks reconcile current Stripe state. Action writes compare subscription, revision and watermark.
 */
async function context() {
  const user = await getSessionUser();
  if (!user) return null;
  return { user, row: await billingRow(user.id) };
}
const live = (row: BillingRow | null) => Boolean(row?.plan && row.stripe_subscription_id && ["active", "trialing", "past_due"].includes(row.status ?? ""));

export async function GET() {
  await connection();
  if (!stripeEnabled()) return Response.json({ enabled: false, subscription: null, card: null, invoices: [] });
  const ctx = await context().catch(() => undefined);
  if (ctx === undefined) return Response.json({ error: "Billing is unavailable. Try again." }, { status: 503 });
  if (!ctx) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { row } = ctx;
  let pendingChange: { plan: string; cycle: string; at: string } | null = null;
  let card: { brand: string; last4: string; expMonth: number; expYear: number } | null = null;
  let invoices: { id: string; date: string; amount: number; currency: string; status: string; plan: string; pdf: string | null }[] = [];
  if (row?.stripe_customer_id) {
    try {
      const [customer, list, sub] = await Promise.all([
        stripe().customers.retrieve(row.stripe_customer_id, { expand: ["invoice_settings.default_payment_method"] }),
        stripe().invoices.list({ customer: row.stripe_customer_id, limit: 24 }),
        row.stripe_subscription_id ? stripe().subscriptions.retrieve(row.stripe_subscription_id, { expand: ["default_payment_method"] }) : null,
      ]);
      const pm = ((sub?.default_payment_method as Stripe.PaymentMethod | null) ?? (!("deleted" in customer) ? (customer.invoice_settings?.default_payment_method as Stripe.PaymentMethod | null) : null)) || null;
      if (sub?.schedule) {
        const schedule = await stripe().subscriptionSchedules.retrieve(typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id);
        const next = schedule.phases.find(p => p.start_date > Date.now() / 1000);
        const price = next?.items[0]?.price;
        const target = planOfPrice(typeof price === "string" ? price : price?.id);
        if (target && next) pendingChange = { ...target, at: new Date(next.start_date * 1000).toISOString() };
      }
      if (pm?.card) card = { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
      invoices = list.data
        .filter((i) => i.status !== "draft")
        .map((i) => ({
          id: i.id ?? "",
          date: new Date(i.created * 1000).toISOString(),
          amount: (i.amount_paid || i.amount_due) / 100,
          currency: i.currency.toUpperCase(),
          status: i.status ?? "",
          plan: i.lines.data[0]?.description ?? "",
          pdf: i.invoice_pdf ?? i.hosted_invoice_url ?? null,
        }));
    } catch (e) {
      console.error("billing details", e);
      return Response.json({error:"Billing is unavailable. Try again."},{status:503});
    }
  }
  return Response.json({
    enabled: true,
    subscription: live(row) ? { plan: row!.plan, cycle: row!.cycle, status: row!.status, periodEnd: row!.current_period_end, cancelAtPeriodEnd: row!.cancel_at_period_end, pendingChange } : null,
    card,
    invoices,
  });
}

export async function POST(request: Request) {
  if (!stripeEnabled()) return Response.json({ error: "Checkout is not connected yet." }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { action?: unknown; plan?: unknown; cycle?: unknown } | null;
  const origin = new URL(request.url).origin;
  const plan = PLANS.find((p) => p.id === body?.plan)?.id;
  const cycle: BillingCycle = body?.cycle === "annual" ? "annual" : "monthly";

  try {
    return await withBillingLock(user.id, async (token) => {
      const row = await billingRow(user.id);
      switch (body?.action) {
        case "checkout": {
          if (!plan) return Response.json({ error: "Pick a plan." }, { status: 400 });
          if (live(row)) return Response.json({ error: "You already have a plan. Change it instead." }, { status: 409 });
          return Response.json({ url: await pendingCheckout(user, token, row, plan, cycle, origin) });
        }
        case "change": {
          if (!plan || !live(row)) return Response.json({ error: "Pick a plan." }, { status: 400 });
          const sub = await stripe().subscriptions.retrieve(row!.stripe_subscription_id!);
          const changed = await changeSubscription(sub, plan, cycle, user.id);
          if (!changed.scheduled) await applyBillingAction(user.id, token, row!, changed.sub);
          return Response.json({ ok: true, scheduled: changed.scheduled });
      }
      case "cancel":
      case "resume": {
        if (!live(row)) return Response.json({ error: "No plan to change." }, { status: 400 });
          await clearPendingChange(await stripe().subscriptions.retrieve(row!.stripe_subscription_id!));
        const updated = await stripe().subscriptions.update(row!.stripe_subscription_id!, body.action === "cancel" ? { cancel_at_period_end: true } : { cancel_at_period_end: false, cancel_at: "" });
        await applyBillingAction(user.id, token, row!, updated);
        return Response.json({ ok: true });
      }
      case "card": {
        if (!row?.stripe_customer_id) return Response.json({ error: "No card on file yet." }, { status: 400 });
        const portal = await stripe().billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: `${origin}/settings/billing`, flow_data: { type: "payment_method_update" } });
        return Response.json({ url: portal.url });
      }
      default:
        return Response.json({ error: "Bad request" }, { status: 400 });
    }
    });
  } catch (e) {
    console.error("billing", body?.action, e);
    if ((e as { statusCode?: number; type?: string }).statusCode === 402 || (e as { type?: string }).type === "StripeCardError") return Response.json({ error: "Payment failed. Update your card." }, { status: 402 });
    if (e instanceof BillingBusy) return Response.json({ error: e.message }, { status: 409 });
    return Response.json({ error: "Billing is not available right now. Try again." }, { status: 502 });
  }
}
