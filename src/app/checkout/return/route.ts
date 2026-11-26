import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { billingRpc, withBillingLock } from "@/lib/server/billing-state";
import { stripe, subscriptionRow } from "@/lib/server/stripe";
import { createSupabaseAdminClient, getSessionUser } from "@/lib/supabase/server";
import { advanceDeletion } from "@/lib/server/account-deletion";
import { CONVERSION_COOKIE, conversionCookie, conversionEventId } from "@/lib/meta-pixel";

/**
 * Stripe Checkout's success page (founder 2026-10-26: someone who pays goes straight into the app and can start at
 * once). Instead of waiting for the webhook, ask Stripe for this Checkout Session, check it is complete and belongs to
 * the signed-in user, and record the subscription through the same locked, ordered billing RPC the webhook uses
 * (`mavya_billing_event`, keyed by the session so a replay is a no-op; newer webhook state cannot be overwritten by
 * this session's earlier creation timestamp). Anything unexpected falls back to Billing, which waits for the webhook.
 */
export const maxDuration = 120;
const FALLBACK = "/settings/billing?paid=1";
/** Stripe amounts are in the smallest unit; these currencies have no decimals (https://docs.stripe.com/currencies). */
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

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
    const db = createSupabaseAdminClient();
    const closed = await db.from("account_deletions").select("user_id").eq("user_id", user.id).maybeSingle();
    if (closed.error) throw closed.error;
    if (closed.data) {
      const binding = await db.from("billing_subscription_ids").select("user_id").eq("subscription_id", subId).maybeSingle();
      if (binding.error) throw binding.error;
      if (binding.data && binding.data.user_id !== user.id) throw new Error("Subscription owner mismatch");
      const current = await stripe().subscriptions.retrieve(subId);
      if (current.metadata?.user_id && current.metadata.user_id !== user.id) throw new Error("Subscription metadata mismatch");
      const live = !["canceled", "incomplete_expired"].includes(current.status);
      await billingRpc("mavya_deletion_event", {
        p_user: user.id, p_event: `checkout-return:${session.id}`, p_type: "checkout.return", p_subscription: subId, p_live: live,
      });
      if (live) await advanceDeletion(user.id);
      return to(FALLBACK);
    }
    let confirmed: Stripe.Subscription | null = null;
    const result = await withBillingLock(user.id, async (token) => {
      const current: Stripe.Subscription = await stripe().subscriptions.retrieve(subId);
      confirmed = current;
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
    const response = to("/studio");
    // Meta Pixel (src/components/meta-pixel.tsx): StartTrial for a card trial, Subscribe for a direct purchase, once.
    const sub = confirmed as Stripe.Subscription | null;
    // Only on the first return from a fresh checkout (an old link opened again later sends nothing), and the event follows
    // the checkout itself: a trial checkout is StartTrial even after the trial has converted (Codex 2026-11-26).
    const fresh = Date.now() / 1000 - session.created < 3600;
    if (sub && fresh && ["trialing", "active"].includes(sub.status)) {
      const price = sub.items?.data?.[0]?.price;
      const currency = price?.currency ?? "usd";
      const value = typeof price?.unit_amount === "number" ? price.unit_amount / (ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100) : 0;
      response.cookies.set(CONVERSION_COOKIE, conversionCookie({ kind: sub.trial_end ? "trial" : "subscribe", eventId: await conversionEventId(session.id), value, currency }), { path: "/", maxAge: 600, sameSite: "lax", secure: true });
    }
    return response;
  } catch (error) {
    console.error("checkout return", sessionId, error);
    return to(FALLBACK);
  }
}
