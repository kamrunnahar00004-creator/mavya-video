import "server-only";
import { cloud } from "@/lib/server/store";
import { createSupabaseAdminClient, getSessionUser } from "@/lib/supabase/server";
import { planById, type PlanId } from "@/lib/plans";

/**
 * Plan limits for AI hooks (src/lib/plans.ts: 20 / 60 / 150 a month).
 * Each Generate is one row in `generations` (supabase/migrations/0002), counted from the start of the subscription
 * period (else the calendar month). The automatic fallback after a refusal is not counted again; a generation that
 * fails completely is given back. Emails in ADMIN_EMAILS (comma separated) are unlimited, for the founder's testing.
 * Without cloud storage (local, one person) there is no limit.
 */
export type Allowance = { plan: PlanId | null; admin: boolean; used: number; limit: number | null; resetsAt: string | null };

const isAdmin = (email: string | undefined) =>
  Boolean(email) &&
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email!.toLowerCase());

type Sub = { plan: PlanId | null; status: string | null; current_period_start: string | null; current_period_end: string | null; cancel_at_period_end: boolean };

/** The active subscription, if any (active or trialing, and the paid period not over). */
export async function subscriptionOf(who: string): Promise<Sub | null> {
  if (!cloud()) return null;
  const { data } = await createSupabaseAdminClient().from("subscriptions").select("plan, status, current_period_start, current_period_end, cancel_at_period_end").eq("user_id", who).maybeSingle<Sub>();
  if (!data?.plan || !["active", "trialing"].includes(data.status ?? "")) return null;
  if (data.current_period_end && new Date(data.current_period_end).getTime() < Date.now()) return null;
  return data;
}

export async function allowance(who: string): Promise<Allowance> {
  if (!cloud()) return { plan: null, admin: true, used: 0, limit: null, resetsAt: null };
  const [user, sub] = await Promise.all([getSessionUser(), subscriptionOf(who)]);
  const admin = isAdmin(user?.email);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const since = sub?.current_period_start && new Date(sub.current_period_start) <= now ? sub.current_period_start : monthStart;
  const { count } = await createSupabaseAdminClient().from("generations").select("id", { count: "exact", head: true }).eq("user_id", who).gte("created_at", since);
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  return {
    plan: sub?.plan ?? null,
    admin,
    used: count ?? 0,
    limit: admin ? null : sub?.plan ? planById(sub.plan).hooks : 0,
    // Yearly plans still count hooks per month.
    resetsAt: sub?.current_period_end && sub.current_period_start === since ? sub.current_period_end : nextMonth,
  };
}

/** Log one AI hook; returns its id (to give it back if the generation fails completely). */
export async function recordGeneration(who: string, runId: string): Promise<string | null> {
  if (!cloud()) return null;
  const { data } = await createSupabaseAdminClient().from("generations").insert({ user_id: who, run_id: runId }).select("id").single<{ id: string }>();
  return data?.id ?? null;
}

export async function refundGeneration(who: string, id: string): Promise<void> {
  if (!cloud() || !/^[0-9a-f-]{36}$/.test(id)) return;
  await createSupabaseAdminClient().from("generations").delete().eq("id", id).eq("user_id", who);
}
