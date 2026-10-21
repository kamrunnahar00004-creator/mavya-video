import type Stripe from "stripe";
import { stripe, subscriptionRow } from "@/lib/server/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Stripe webhook: the only writer of a user's plan (`subscriptions`). Public route (Stripe calls it), so:
 * - the signature is checked on the raw body before anything is read;
 * - an event already handled is acknowledged without reprocessing (`billing_events`);
 * - an older event arriving late never overwrites a newer state (`last_event_created`);
 * - the user comes from our own metadata (set at checkout), else the stored Stripe customer id.
 * Endpoint in Stripe: https://mavya.app/api/stripe/webhook, events checkout.session.completed,
 * customer.subscription.created/updated/deleted, invoice.paid.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "not configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing signature" }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(await request.text(), signature, secret);
  } catch {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { data: seen } = await db.from("billing_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return Response.json({ received: true, duplicate: true });

  try {
    let sub: Stripe.Subscription | null = null;
    let userId: string | null = null;
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (subId) sub = await stripe().subscriptions.retrieve(subId);
      userId = session.client_reference_id;
    } else if (event.type.startsWith("customer.subscription.")) {
      sub = event.data.object as Stripe.Subscription;
    } else if (event.type === "invoice.paid") {
      const inv = event.data.object as unknown as { subscription?: string | { id?: string } | null; parent?: { subscription_details?: { subscription?: string | { id?: string } | null } } };
      const ref = inv.subscription ?? inv.parent?.subscription_details?.subscription;
      const subId = typeof ref === "string" ? ref : ref?.id;
      if (subId) sub = await stripe().subscriptions.retrieve(subId);
    }

    if (sub) {
      userId ??= typeof sub.metadata?.user_id === "string" && sub.metadata.user_id ? sub.metadata.user_id : null;
      if (!userId) {
        const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const { data, error } = await db.from("subscriptions").select("user_id").eq("stripe_customer_id", customer).maybeSingle<{ user_id: string }>();
        // A failed lookup is retried by Stripe (500), never marked done unapplied.
        if (error) throw error;
        userId = data?.user_id ?? null;
      }
      if (userId) {
        const { data: current } = await db.from("subscriptions").select("last_event_created").eq("user_id", userId).maybeSingle<{ last_event_created: number }>();
        if (!current || current.last_event_created <= event.created) {
          const { error } = await db.from("subscriptions").upsert(subscriptionRow(userId, sub, event.created), { onConflict: "user_id" });
          if (error) throw error;
        }
      } else {
        console.error("stripe webhook: subscription without a user", sub.id);
      }
    }
  } catch (e) {
    console.error("stripe webhook failed", event.type, e);
    return Response.json({ error: "processing failure" }, { status: 500 });
  }

  const { error } = await db.from("billing_events").insert({ id: event.id, type: event.type });
  if (error && error.code !== "23505") return Response.json({ error: "storage failure" }, { status: 500 });
  return Response.json({ received: true });
}
