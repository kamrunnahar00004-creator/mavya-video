import "server-only";
import { cloud } from "@/lib/server/store";
import { createSupabaseAdminClient, getSessionUser } from "@/lib/supabase/server";
import type { BillingCycle, PlanId } from "@/lib/plans";

export type Allowance = { plan: PlanId | null; admin: boolean; used: number; limit: number | null; resetsAt: string | null };

export async function adminUser(who: string): Promise<boolean> {
  const user = await getSessionUser();
  return user?.id === who && Boolean(user.email) && (process.env.ADMIN_EMAILS ?? "").split(",")
    .map((email) => email.trim().toLowerCase()).filter(Boolean).includes(user.email!.toLowerCase());
}

type Sub = { plan: PlanId | null; cycle: BillingCycle | null; status: string | null; current_period_start: string | null; current_period_end: string | null; cancel_at_period_end: boolean };

export async function subscriptionOf(who: string): Promise<Sub | null> {
  if (!cloud()) return null;
  const { data, error } = await createSupabaseAdminClient().from("subscriptions").select("plan, cycle, status, current_period_start, current_period_end, cancel_at_period_end").eq("user_id", who).maybeSingle<Sub>();
  if (error) throw error;
  if (!data?.plan || !["active", "trialing"].includes(data.status ?? "")) return null;
  if (!data.current_period_start || !data.current_period_end || new Date(data.current_period_start).getTime() > Date.now() || new Date(data.current_period_end).getTime() <= Date.now()) return null;
  return data;
}

/** Read the same monthly window and ledger that the atomic reservation uses. Errors fail closed. */
export async function allowance(who: string): Promise<Allowance> {
  if (!cloud()) return { plan: null, admin: false, used: 0, limit: 0, resetsAt: null };
  const { data, error } = await createSupabaseAdminClient().rpc("mavya_allowance", { p_user: who, p_admin: await adminUser(who) });
  if (error || !data) throw error ?? new Error("Allowance unavailable");
  return data as Allowance;
}
