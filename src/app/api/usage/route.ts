import { readResponse } from "@/lib/server/read-timing";
import { billingRow, trialEligible } from "@/lib/server/billing-state";
import { connection } from "next/server";
import { allowance, subscriptionOf } from "@/lib/server/usage";
import { currentUser, signInFirst } from "@/lib/server/who";

/** The signed-in user's plan, AI hooks used this period and the limit (Settings > Usage and Billing), and whether a
 *  first checkout would start a free trial. */
export async function GET() {
  return readResponse(() => readGET());
}

async function readGET() {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  const [a, sub, billing] = await Promise.all([allowance(who), subscriptionOf(who), billingRow(who)]);
  // Only someone without a plan can start a trial; skip the check for everyone else.
  const trial = !a.plan && !a.admin && !billing?.stripe_subscription_id ? await trialEligible(who).catch(() => false) : false;
  return Response.json({
    ...a, billingStatus: billing?.status ?? null, trialEligible: trial,
    subscription: sub ? { plan: sub.plan, status: sub.status, periodEnd: sub.current_period_end, cancelAtPeriodEnd: sub.cancel_at_period_end } : null,
  });
}
