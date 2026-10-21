import { connection } from "next/server";
import type Stripe from "stripe";
import { PLANS, type BillingCycle, type PlanId } from "@/lib/plans";
import { priceFor, stripe, stripeEnabled, subscriptionRow } from "@/lib/server/stripe";
import { createSupabaseAdminClient, getSessionUser } from "@/lib/supabase/server";

/**
 * Settings > Billing and Plans.
 * GET: the plan (from our `subscriptions`, written by the webhook), the card on file and the invoices (from Stripe).
 * POST {action}:
 *   "checkout" {plan, cycle}  -> {url}  Stripe Checkout for a first plan
 *   "change"   {plan, cycle}  -> {ok}   switch plan, prorated (an active subscription)
 *   "cancel"                  -> {ok}   ends at the period end; access stays until then
 *   "resume"                  -> {ok}   undo a cancel before it ends
 *   "card"                    -> {url}  Stripe's page to update the card
 * The plan itself only changes through the webhook, so the page reloads it a moment after.
 */
type Row = { plan: PlanId | null; cycle: BillingCycle | null; status: string | null; current_period_end: string | null; cancel_at_period_end: boolean; stripe_customer_id: string | null; stripe_subscription_id: string | null; last_event_created: number };

async function context() {
  const user = await getSessionUser();
  if (!user) return null;
  const { data } = await createSupabaseAdminClient().from("subscriptions").select("plan, cycle, status, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, last_event_created").eq("user_id", user.id).maybeSingle<Row>();
  return { user, row: data };
}
const live = (row: Row | null) => Boolean(row?.plan && row.stripe_subscription_id && ["active", "trialing", "past_due"].includes(row.status ?? ""));

export async function GET() {
  await connection();
  if (!stripeEnabled()) return Response.json({ enabled: false, subscription: null, card: null, invoices: [] });
  const ctx = await context();
  if (!ctx) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { row } = ctx;
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
    }
  }
  return Response.json({
    enabled: true,
    subscription: live(row) ? { plan: row!.plan, cycle: row!.cycle, status: row!.status, periodEnd: row!.current_period_end, cancelAtPeriodEnd: row!.cancel_at_period_end } : null,
    card,
    invoices,
  });
}

export async function POST(request: Request) {
  if (!stripeEnabled()) return Response.json({ error: "Checkout is not connected yet." }, { status: 503 });
  const ctx = await context();
  if (!ctx) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { user, row } = ctx;
  const body = (await request.json().catch(() => null)) as { action?: unknown; plan?: unknown; cycle?: unknown } | null;
  const origin = new URL(request.url).origin;
  const plan = PLANS.find((p) => p.id === body?.plan)?.id;
  const cycle: BillingCycle = body?.cycle === "annual" ? "annual" : "monthly";

  try {
    switch (body?.action) {
      case "checkout": {
        if (!plan) return Response.json({ error: "Pick a plan." }, { status: 400 });
        if (live(row)) return Response.json({ error: "You already have a plan. Change it instead." }, { status: 409 });
        const session = await stripe().checkout.sessions.create({
          mode: "subscription",
          line_items: [{ price: priceFor(plan, cycle), quantity: 1 }],
          client_reference_id: user.id,
          subscription_data: { metadata: { user_id: user.id } },
          ...(row?.stripe_customer_id ? { customer: row.stripe_customer_id } : { customer_email: user.email }),
          allow_promotion_codes: true,
          success_url: `${origin}/settings/billing?paid=1`,
          cancel_url: `${origin}/settings/plans`,
        });
        return Response.json({ url: session.url });
      }
      case "change": {
        if (!plan || !live(row)) return Response.json({ error: "Pick a plan." }, { status: 400 });
        const sub = await stripe().subscriptions.retrieve(row!.stripe_subscription_id!);
        const updated = await stripe().subscriptions.update(sub.id, {
          items: [{ id: sub.items.data[0].id, price: priceFor(plan, cycle) }],
          proration_behavior: "create_prorations",
          cancel_at_period_end: false,
          metadata: { user_id: user.id },
        });
        await save(user.id, updated, row!.last_event_created);
        return Response.json({ ok: true });
      }
      case "cancel":
      case "resume": {
        if (!live(row)) return Response.json({ error: "No plan to change." }, { status: 400 });
        const updated = await stripe().subscriptions.update(row!.stripe_subscription_id!, body.action === "cancel" ? { cancel_at_period_end: true } : { cancel_at_period_end: false, cancel_at: "" });
        await save(user.id, updated, row!.last_event_created);
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
  } catch (e) {
    console.error("billing", body?.action, e);
    return Response.json({ error: "Billing is not available right now. Try again." }, { status: 502 });
  }
}

/** Show the change at once; the webhook confirms it (same event time, so it still applies). */
async function save(userId: string, sub: Stripe.Subscription, eventCreated: number) {
  await createSupabaseAdminClient().from("subscriptions").upsert(subscriptionRow(userId, sub, eventCreated), { onConflict: "user_id" });
}
