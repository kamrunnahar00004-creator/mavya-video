/**
 * Meta Pixel (founder 2026-11-07): PageView on every page and CompleteRegistration once per new account, so a later
 * US ad test can optimise for signups. Off until NEXT_PUBLIC_META_PIXEL_ID is set (Meta Events Manager > Datasets).
 */

/** The cookie /auth/continue sets for a brand-new account; the browser reads it once, fires the event, deletes it. */
export const SIGNUP_COOKIE = "mv_signup";

/** An account counts as new on its first arrival at /auth/continue within this window of being created. */
export const NEW_ACCOUNT_MS = 10 * 60 * 1000;

/** The Pixel id, only if it is all digits (it goes into an inline script). */
export function pixelId(raw: string | undefined): string | null {
  const id = raw?.trim() ?? "";
  return /^\d{5,20}$/.test(id) ? id : null;
}

/** True when `createdAt` (ISO time) is within NEW_ACCOUNT_MS before `now`. Bad or future times are not new. */
export function isNewSignup(createdAt: string | undefined, now: number): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age >= -60_000 && age <= NEW_ACCOUNT_MS;
}

/**
 * No Pixel for visitors whose browser time zone is in Europe (EU/EEA, UK and Switzerland need consent for ad
 * tracking, and Mavya has no consent banner). An unknown time zone also gets no Pixel.
 */
export function pixelAllowed(timeZone: string | undefined): boolean {
  if (!timeZone) return false;
  if (timeZone.startsWith("Europe/")) return false;
  return !["Atlantic/Reykjavik", "Atlantic/Canary", "Atlantic/Madeira", "Atlantic/Azores", "Atlantic/Faroe", "Arctic/Longyearbyen"].includes(timeZone);
}

/** Meta's deduplication id for one account's signup: the same account never counts twice. */
export async function signupEventId(userId: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mavya-signup:${userId}`)));
  return `signup-${Array.from(bytes.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The signup cookie's value, if it is one this app set (hex event id); anything else is ignored. */
/**
 * StartTrial / Subscribe (founder 2026-11-26, for paid ads): /checkout/return sets this cookie once Stripe confirms the
 * buyer's own checkout; the browser fires the event once and deletes it. Value: "trial|<eventId>|<amount>|<currency>"
 * or "subscribe|...". The event id is derived from the Checkout Session, so a reload never counts twice.
 */
export const CONVERSION_COOKIE = "mv_conv";
export type Conversion = { kind: "trial" | "subscribe"; eventId: string; value: number; currency: string };

export async function conversionEventId(sessionId: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mavya-checkout:${sessionId}`)));
  return `checkout-${Array.from(bytes.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export const conversionCookie = (c: Conversion) => `${c.kind}|${c.eventId}|${Math.max(0, Math.round(c.value * 100) / 100)}|${c.currency.toUpperCase().slice(0, 3)}`;
export function readConversionCookie(cookie: string): Conversion | null {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${CONVERSION_COOKIE}=(trial|subscribe)(?:\\||%7C)(checkout-[0-9a-f]{24})(?:\\||%7C)(\\d+(?:\\.\\d{1,2})?)(?:\\||%7C)([A-Za-z]{3})(?:;|$)`));
  return m ? { kind: m[1] as Conversion["kind"], eventId: m[2], value: Number(m[3]), currency: m[4].toUpperCase() } : null;
}

export function readSignupCookie(cookie: string): string | null {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SIGNUP_COOKIE}=(signup-[0-9a-f]{24})(?:;|$)`));
  return m ? m[1] : null;
}
