import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { billingRpc, withBillingLock } from "@/lib/server/billing-state";
import { stripe, subscriptionRow } from "@/lib/server/stripe";
import { getSessionUser } from "@/lib/supabase/server";

/**
 * Stripe Checkout's success page (founder 2026-10-26: someone who pays goes straight into the app and can start at
 * once). Instead of waiting for the webhook, ask Stripe for this Checkout Session, check it is complete and belongs to
 * the signed-in user, and record the subscription through the same locked, ordered billing RPC the webhook uses
 * (`mavya_billing_event`, keyed by the session so a replay is a no-op; a later webhook for the same subscription is
 * simply older or a duplicate). Anything unexpected falls back to Billing, which keeps waiting for the webhook.
 */
export const maxDuration = 60;
const FALLBACK = "/settings/billing?paid=1";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const to = (path: string) => NextResponse.redirect(`${origin}${path}`);
  const sessionId = searchParams.get("session_id") ?? "";
  const user = await getSessionUser();
  if (!user) return to(`/?auth=login&next=${encodeURIComponent(FALLBACK)}`);
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return to(FALLBACK);
  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    // Only the buyer's own completed, paid (or free with a coupon) subscription checkout.
    if (session.client_reference_id !== user.id || session.status !== "complete" || !subId || !["paid", "no_payment_required"].includes(session.payment_status)) {
      return to(FALLBACK);
    }
    const result = await withBillingLock(user.id, async (token) => {
      const current: Stripe.Subscription = await stripe().subscriptions.retrieve(subId);
      if (current.metadata?.user_id && current.metadata.user_id !== user.id) throw new Error("Subscription metadata mismatch");
      return billingRpc<string>("mavya_billing_event", {
        p_user: user.id, p_token: token, p_event: `checkout-return:${session.id}`, p_type: "checkout.return",
        p_created: session.created, p_state: subscriptionRow(user.id, current, session.created), p_checkout: session.id,
      });
    });
    if (result === "conflict") {
      console.error("checkout return: duplicate subscription, support review required", { user: user.id, session: session.id });
      return to(FALLBACK);
    }
    // A full page load into the app; the proxy gate now sees the plan.
    return to("/studio");
  } catch (error) {
    console.error("checkout return", sessionId, error);
    return to(FALLBACK);
  }
}
