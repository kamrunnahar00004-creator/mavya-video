import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { subscriptionOf } from "@/lib/server/usage";

/**
 * Upload from phone (founder 2026-11-27): the computer shows a QR code; the phone opens /phone/<token>, picks videos
 * from its library, and they land in the video's clips on the computer. The token is signed (no one can make one for
 * someone else's video), names one user and one video, and lasts an hour; nothing else is needed on the phone.
 * Phone uploads leave a note in an inbox (billing_events rows `phone:<video>:...`, no migration); the computer reads
 * them and places the clips with its own upload code, so texts and captions move exactly as with a computer upload.
 */

const LIFE_MS = 60 * 60 * 1000;
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", key()).update(`phone-link:${body}`).digest("base64url").slice(0, 32);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makePhoneToken(user: string, run: string, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + LIFE_MS;
  const body = b64(`${user}.${run}.${expiresAt}`);
  return { token: `${body}.${sign(body)}`, expiresAt };
}

/** The user and video a token is for, or null when it is forged, malformed or expired. */
export function readPhoneToken(token: string, now = Date.now()): { user: string; run: string } | null {
  if (!key() || typeof token !== "string" || token.length > 300) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [user, run, exp] = Buffer.from(body, "base64url").toString().split(".");
  if (!UUID.test(user ?? "") || !UUID.test(run ?? "") || !(Number(exp) > now)) return null;
  return { user, run };
}

/** Phone uploads are a paid feature, like uploads from the computer. */
export async function mayUpload(user: string): Promise<boolean> {
  if ((process.env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).includes(user)) return true;
  return Boolean(await subscriptionOf(user));
}

const db = () => createSupabaseAdminClient();
export type PhoneClip = { key: string; mediaId: string; seconds: number | null };

/** Adds an uploaded video to the video's inbox. `order` keeps the phone's picking order. */
export async function addToInbox(run: string, order: number, mediaId: string, seconds: number | null): Promise<"ok" | "full"> {
  // The same video once per video, and at most 60 notes an hour per video (Codex 2026-11-27: a link replayed).
  const { data: seen, error: e1 } = await db().from("billing_events").select("id").like("id", `phone:${run}:%:${mediaId}:%`).limit(1);
  if (e1) throw e1;
  if (seen?.length) return "ok";
  const { count, error: e2 } = await db().from("billing_events").select("id", { count: "exact", head: true }).like("id", `phone:${run}:%`).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if (e2) throw e2;
  if ((count ?? 0) >= 60) return "full";
  const ms = seconds && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
  const id = `phone:${run}:${Date.now().toString(36)}-${String(order).padStart(3, "0")}:${mediaId}:${ms}`;
  const { error } = await db().from("billing_events").upsert({ id, type: "phone.clip" }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
  return "ok";
}

/** The phone uploads waiting to be placed in this video, in the order they were picked. */
export async function readInbox(run: string): Promise<PhoneClip[]> {
  const { data, error } = await db().from("billing_events").select("id").eq("type", "phone.clip").like("id", `phone:${run}:%`).order("id").limit(50);
  if (error) throw error;
  return (data ?? []).flatMap(({ id }: { id: string }) => {
    const [, , , mediaId, ms] = id.split(":");
    return mediaId ? [{ key: id, mediaId, seconds: Number(ms) > 0 ? Number(ms) / 1000 : null }] : [];
  });
}

/** Marks inbox notes as placed, so they are never placed twice. */
export async function clearInbox(run: string, keys: string[]): Promise<void> {
  const mine = keys.filter((k) => typeof k === "string" && k.startsWith(`phone:${run}:`)).slice(0, 50);
  if (!mine.length) return;
  const { error } = await db().from("billing_events").update({ type: "phone.used" }).in("id", mine).eq("type", "phone.clip");
  if (error) throw error;
}
