import type Stripe from "stripe";
import { stripe, subscriptionRow } from "@/lib/server/stripe";
import { billingRpc, withBillingLock } from "@/lib/server/billing-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { advanceDeletion } from "@/lib/server/account-deletion";
import { stripeWebhookSecret } from "@/lib/production-config";

export const maxDuration = 120;
const idOf = (value: string | { id?: string } | null | undefined) => typeof value === "string" ? value : value?.id;
/** Signature first. Fetch current Stripe state under a per-account lease, then atomically claim/apply. */
export async function POST(request: Request) {
  const secret = stripeWebhookSecret();
  if (!secret) {
    console.error("stripe_webhook_config_invalid");
    return Response.json({ error: "not configured" }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing signature" }, { status: 400 });
  let event: Stripe.Event;
  try { event = await stripe().webhooks.constructEventAsync(await request.text(), signature, secret); }
  catch {
    // Distinct alertable marker. Never log the secret, signature or untrusted request body.
    console.error("stripe_webhook_signature_invalid");
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }
  try {
    let subId: string | undefined, userId: string | null = null, checkout: string | null = null;
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      subId = idOf(session.subscription); userId = session.client_reference_id; checkout = session.id;
      if (!subId) return Response.json({ received: true }); // Non-subscription Checkout.
    } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      const sub = event.data.object as Stripe.Subscription;
      subId = sub.id; userId = sub.metadata?.user_id || null;
    } else if (event.type === "invoice.paid") {
      const invoice = event.data.object as unknown as { subscription?: string | { id?: string } | null; parent?: { subscription_details?: { subscription?: string | { id?: string } | null } } };
      subId = idOf(invoice.subscription ?? invoice.parent?.subscription_details?.subscription);
      if (!subId) return Response.json({ received: true });
    } else return Response.json({ received: true });
    if (!subId) throw new Error("Missing subscription");
    const db = createSupabaseAdminClient();
    const binding = await db.from("billing_subscription_ids").select("user_id").eq("subscription_id", subId).maybeSingle<{ user_id: string }>();
    if (binding.error) throw binding.error;
    if (binding.data) {
      if (userId && userId !== binding.data.user_id) throw new Error("Subscription owner mismatch");
      userId = binding.data.user_id;
    }
    if (!userId) {
      const deletedBinding = await db.from("account_deletions").select("user_id").contains("known_subscription_ids", [subId]).maybeSingle<{user_id:string}>();
      if (deletedBinding.error) throw deletedBinding.error;
      userId = deletedBinding.data?.user_id ?? null;
    }
    if (!userId) {
      const sub = await stripe().subscriptions.retrieve(subId);
      userId = sub.metadata?.user_id || null;
      if (!userId) {
        const lookup = await db.from("subscriptions").select("user_id").eq("stripe_customer_id", idOf(sub.customer)).maybeSingle<{ user_id: string }>();
        if (lookup.error) throw lookup.error;
        userId = lookup.data?.user_id ?? null;
        if (!userId) {
          const deletedCustomer = await db.from("account_deletions").select("user_id").eq("stripe_customer_id", idOf(sub.customer)).maybeSingle<{user_id:string}>();
          if (deletedCustomer.error) throw deletedCustomer.error;
          userId = deletedCustomer.data?.user_id ?? null;
        }
      }
    }
    if (!userId) {
      // Every authoritative lookup above succeeded. Retrying an unowned legacy subscription cannot repair it.
      console.error("stripe_webhook_owner_unresolved", { event: event.id, subscription: subId });
      return Response.json({ received: true, result: "unowned" });
    }
    const owner = userId;
    const closed = await db.from("account_deletions").select("user_id").eq("user_id", owner).maybeSingle();
    if (closed.error) throw closed.error;
    if (closed.data) {
      const current = await stripe().subscriptions.retrieve(subId);
      if (current.metadata?.user_id && current.metadata.user_id !== owner) throw new Error("Deleted subscription owner mismatch");
      const live = !["canceled", "incomplete_expired"].includes(current.status);
      const result = await billingRpc<string>("mavya_deletion_event", { p_user: owner, p_event: event.id, p_type: event.type, p_subscription: subId, p_live: live });
      if (live) await advanceDeletion(owner);
      return Response.json({ received: true, result });
    }
    const result = await withBillingLock(owner, async (token) => {
      // Even equal-second deliveries reconcile serially against Stripe, not their old payloads.
      const current = await stripe().subscriptions.retrieve(subId!);
      if (current.metadata?.user_id && current.metadata.user_id !== owner) throw new Error("Subscription metadata mismatch");
      return billingRpc<string>("mavya_billing_event", {
        p_user: owner, p_token: token, p_event: event.id, p_type: event.type, p_created: event.created,
        p_state: subscriptionRow(owner, current, event.created), p_checkout: checkout,
      });
    });
    if (result === "conflict") console.error("stripe duplicate subscription: support review required", { event: event.id, user: owner, subscription: subId });
    return Response.json({ received: true, result });
  } catch (error) {
    console.error("stripe webhook failed", event.type, error);
    // Failed lookups/reconciliation/transactions never mark the event done. Stripe must retry.
    return Response.json({ error: "processing failure" }, { status: 500 });
  }
}
