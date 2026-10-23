import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { billingRpc, withBillingLock } from "@/lib/server/billing-state";
import { accountClosing } from "@/lib/server/account-state";
import { stripe } from "@/lib/server/stripe";
import { deleteObjectStrict } from "@/lib/server/r2";
import type Stripe from "stripe";
type Deletion = { user_id: string; state: string; subscription_ids: string[]; checkout: { session_id?: string; params: Stripe.Checkout.SessionCreateParams; request_key: string; created_at: string } | null; media_ids: string[]; extra_keys?: string[]; cursor: number; cleanup_after: string; lease_token: string };
export async function beginDeletion(user: string) {
 if (await accountClosing(user)) return;
 await withBillingLock(user, token => billingRpc("mavya_begin_deletion", { p_user: user, p_token: token }));
}
/** Bounded, leased work. Retry DELETE or the daily cron to continue, including after auth removal. */
export async function advanceDeletion(user: string) {
 const d = await billingRpc<Deletion | null>("mavya_claim_deletion", { p_user: user });
 if (!d) return;
 const db = createSupabaseAdminClient();
 const save = async (patch: Record<string, unknown>) => {
  const { error, data } = await db.from("account_deletions").update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", user).eq("lease_token", d.lease_token).select("user_id");
  if (error || !data?.length) throw error ?? new Error("Deletion lease changed");
 };
 try {
  if (d.state === "cancel") {
   const c = d.checkout;
   if (c) {
    if (!c.session_id && Date.now() - Date.parse(c.created_at) > 23 * 3600_000) throw new Error("Checkout needs support recovery before deletion");
    const session = c.session_id ? await stripe().checkout.sessions.retrieve(c.session_id) : await stripe().checkout.sessions.create(c.params, { idempotencyKey: `mavya-checkout-${c.request_key}` });
    if (session.status === "open") await stripe().checkout.sessions.expire(session.id);
    const sub = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (sub && !d.subscription_ids.includes(sub)) d.subscription_ids.push(sub);
   }
   // Bounded to fit Hobby. Cancellation is idempotent if a later step fails.
   for (const sub of d.subscription_ids.slice(0, 5)) {
    const current = await stripe().subscriptions.retrieve(sub);
    if (!["canceled", "incomplete_expired"].includes(current.status)) await stripe().subscriptions.cancel(sub, { invoice_now: false, prorate: false });
    d.subscription_ids.shift();
   }
   await save({ subscription_ids: d.subscription_ids, checkout: null, state: d.subscription_ids.length ? "cancel" : "storage", error: null });
   if (d.subscription_ids.length) throw new Error("More subscriptions need cancellation. Retry deletion.");
   d.state = "storage";
  }
  // Existing signed export PUTs last six hours. Keep the ownership index until those grants expire.
  if (Date.now() < Date.parse(d.cleanup_after)) return;
  if (d.state === "storage") {
   const keys = [...d.media_ids.map(id => `media/${id}`), ...(d.extra_keys ?? [])];
   const batch = keys.slice(d.cursor, d.cursor + 40);
   for (let i = 0; i < batch.length; i += 5) await Promise.all(batch.slice(i, i + 5).map(key => deleteObjectStrict(key)));
   d.cursor += batch.length;
   await save({ cursor: d.cursor, state: d.cursor < keys.length ? "storage" : "auth", error: null });
   if (d.cursor < keys.length) return;
  }
  const { error } = await db.auth.admin.deleteUser(user);
  if (error && error.code !== "user_not_found" && error.status !== 404) throw error;
  await save({ state: "done", media_ids: [], checkout: null, error: null });
 } catch (error) {
  await save({ error: "Deletion failed. Email hello@mavya.app." });
  throw error;
 } finally {
  await save({ lease_token: null, lease_until: null });
 }
}
