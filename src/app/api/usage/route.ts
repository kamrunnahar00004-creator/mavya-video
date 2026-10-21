import { connection } from "next/server";
import { allowance, subscriptionOf } from "@/lib/server/usage";
import { currentUser, signInFirst } from "@/lib/server/who";

/** The signed-in user's plan, AI hooks used this period and the limit (Settings > Usage and Billing). */
export async function GET() {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  const [a, sub] = await Promise.all([allowance(who), subscriptionOf(who)]);
  return Response.json({
    ...a,
    subscription: sub ? { plan: sub.plan, status: sub.status, periodEnd: sub.current_period_end, cancelAtPeriodEnd: sub.cancel_at_period_end } : null,
  });
}
