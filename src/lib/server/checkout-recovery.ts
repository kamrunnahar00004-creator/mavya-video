import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import { stripe } from "@/lib/server/stripe";
import { subscriptionOf } from "@/lib/server/usage";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SITE, STEP_HOURS, DUE_WINDOW_H, dueStep, recoveryEmail } from "@/lib/recovery-email";

/**
 * Checkout recovery (founder 2026-11-27). Stripe cannot send its own recovery email from this account's country, so
 * Mavya sends three (src/lib/recovery-email.ts) from its cron (/api/internal/recovery, every 15 minutes):
 * - only for a person's LATEST checkout, when it expired unpaid, and only while they have no trial or plan;
 * - each email at most once: it is sent with a Resend Idempotency-Key per checkout and step (two overlapping runs,
 *   or a run that dies before recording, send it once), then recorded in billing_events (`recovery:<session>:<step>`,
 *   no migration needed) so later runs skip it;
 * - never after an unsubscribe (`recovery-stop:<user>`), nor once they started a newer checkout (billing_checkouts).
 * The button opens the pricing page, so a new checkout always goes through Mavya's own checks (Codex 2026-11-27:
 * Stripe's recovery link would skip them and could start a second subscription).
 */

const db = () => createSupabaseAdminClient();
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Signed unsubscribe token for a user, so the link cannot be forged for someone else. */
export const stopToken = (user: string) => createHmac("sha256", key()).update(`recovery-stop:${user}`).digest("hex").slice(0, 32);
export function validStop(user: string, token: string): boolean {
  if (!/^[0-9a-f-]{36}$/.test(user) || !/^[0-9a-f]{32}$/.test(token) || !key()) return false;
  return timingSafeEqual(Buffer.from(stopToken(user)), Buffer.from(token));
}
export const stopLink = (user: string) => `${SITE}/api/email/stop?u=${user}&t=${stopToken(user)}`;

/** Records an unsubscribe (idempotent). */
export async function stopRecovery(user: string): Promise<void> {
  const { error } = await db().from("billing_events").upsert({ id: `recovery-stop:${user}`, type: "recovery.stop" }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
}

async function recorded(id: string): Promise<boolean> {
  const { data, error } = await db().from("billing_events").select("id").eq("id", id).limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}
async function record(id: string) {
  const { error } = await db().from("billing_events").upsert({ id, type: "recovery.email" }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
}
/** True when they opened another checkout after this one (it is recorded before Stripe opens it). */
async function newerCheckout(user: string, session: string, created: number): Promise<boolean> {
  const { data, error } = await db().from("billing_checkouts").select("session_id,created_at").eq("user_id", user).limit(1);
  if (error) throw error;
  const row = data?.[0] as { session_id: string | null; created_at: string } | undefined;
  return Boolean(row && row.session_id !== session && Date.parse(row.created_at) > created * 1000);
}
async function stopped(user: string): Promise<boolean> {
  const { data, error } = await db().from("billing_events").select("id").eq("id", `recovery-stop:${user}`).limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function send(to: string, mail: { subject: string; html: string; text: string }, idem: string, fetcher: typeof fetch): Promise<boolean> {
  const res = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": idem },
    body: JSON.stringify({ from: "Mavya <hello@mavya.app>", to: [to], reply_to: "hello@mavya.app", subject: mail.subject, html: mail.html, text: mail.text }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) console.error("recovery email failed", res?.status ?? "network");
  return Boolean(res?.ok);
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

/** One cron pass: sends the emails due now. Returns how many went out. */
export async function runRecovery(now = Date.now(), fetcher: typeof fetch = fetch, list: (since: number) => AsyncIterable<Stripe.Checkout.Session> = (since) => stripe().checkout.sessions.list({ created: { gte: since }, limit: 100 })): Promise<number> {
  if (!process.env.RESEND_API_KEY) return 0;
  // Checkouts open for an hour, then the last email is due within 72 + 24 hours of that: 5 days back covers it.
  const since = Math.floor((now - (STEP_HOURS[STEP_HOURS.length - 1] + DUE_WINDOW_H + 26) * 3600_000) / 1000);
  const latest = new Map<string, Stripe.Checkout.Session>();
  for await (const s of list(since)) {
    const user = s.client_reference_id;
    if (!user || s.mode !== "subscription") continue;
    const seen = latest.get(user);
    if (!seen || s.created > seen.created) latest.set(user, s);
  }
  let sent = 0;
  for (const [user, s] of latest) {
    // Only an expired, unpaid checkout that is their newest (a newer open or finished one means they came back).
    if (s.status !== "expired" || s.payment_status === "paid") continue;
    const step = dueStep(s.expires_at * 1000, now);
    if (step === null) continue;
    const to = (s.customer_details?.email ?? s.customer_email ?? "").trim();
    if (!EMAIL.test(to)) continue;
    const id = `recovery:${s.id}:${step}`;
    if (await recorded(id)) continue;
    if (await stopped(user)) continue;
    // Checked last, right before sending (Codex 2026-11-27: a payment can land after the Stripe list was read).
    if (await newerCheckout(user, s.id, s.created)) continue;
    if (await subscriptionOf(user)) continue;
    if (!(await send(to, recoveryEmail(step, `${SITE}/pricing`, stopLink(user)), id, fetcher))) continue;
    await record(id);
    sent++;
  }
  return sent;
}
