/**
 * Where a signup came from (founder 2026-11-27, paid Meta ads): the ad's codes from the first tagged visit (utm_* and
 * Meta's fbclid) are kept in a first-party cookie, then saved on the account when it is created (/auth/continue), so
 * Mavya can tell ad signups from Instagram-post signups. Only visits that carry those codes set it, and the first one
 * wins (a later tagged visit never overwrites it). Short, cleaned values only: it goes into a cookie and app_metadata.
 */

export const SOURCE_COOKIE = "mavya_src";
export const SOURCE_DAYS = 30;

export type Source = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  utm_id?: string;
  fbclid?: string;
  /** First tagged visit, ISO time. */
  at: string;
};

const KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "fbclid"] as const;
// Letters and digits in any language, plus a few separators; markup and quotes are dropped (Codex 2026-11-27).
const clean = (v: string, max: number) => v.replace(/[^\p{L}\p{N}_ .:|@+\-]/gu, "").slice(0, max).trim();

/** The ad codes in a page's query, or null when it has none. */
export function sourceFromSearch(search: string, now: Date): Source | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(search); } catch { return null; }
  const out: Source = { at: now.toISOString() };
  let found = false;
  for (const k of KEYS) {
    const v = params.get(k);
    if (!v) continue;
    const c = clean(v, k === "fbclid" ? 200 : 100);
    if (c) { out[k] = c; found = true; }
  }
  return found ? out : null;
}

/** Reads and checks the cookie value (it comes from the browser, so nothing is trusted). */
export function readSource(raw: string | undefined | null): Source | null {
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(decodeURIComponent(raw)); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const at = typeof d.at === "string" && !Number.isNaN(Date.parse(d.at)) ? new Date(d.at).toISOString() : null;
  if (!at) return null;
  const out: Source = { at };
  let found = false;
  for (const k of KEYS) {
    const v = d[k];
    if (typeof v !== "string") continue;
    const c = clean(v, k === "fbclid" ? 200 : 100);
    if (c) { out[k] = c; found = true; }
  }
  return found ? out : null;
}

/** True when the tagged visit came before the account existed (a returning user's later visit never counts). */
export const beforeSignup = (s: Source, createdAt: string) => Date.parse(s.at) <= Date.parse(createdAt) + 60_000;

/** The cookie value, kept under 3,000 bytes (browsers drop cookies over 4 KB; non-Latin names encode large, Codex). */
export function writeSource(s: Source): string {
  const out: Source = { ...s };
  let value = encodeURIComponent(JSON.stringify(out));
  for (let max = 60; value.length > 3000 && max >= 10; max -= 10) {
    for (const k of KEYS) if (k !== "fbclid" && out[k]) out[k] = out[k]!.slice(0, max);
    value = encodeURIComponent(JSON.stringify(out));
  }
  return value;
}
