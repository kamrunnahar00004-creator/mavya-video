import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth-next";
import { allowance } from "@/lib/server/usage";
import { getSessionUser } from "@/lib/supabase/server";
import { billingRow } from "@/lib/server/billing-state";
import { NEW_ACCOUNT_MS, SIGNUP_COOKIE, isNewSignup, signupEventId } from "@/lib/meta-pixel";

/**
 * Where people land after signing in or signing up (password, Google or the email link).
 * Founder 2026-10-24: anyone without a plan goes to the pricing page (full comparison) to choose one; people with a plan (and admins)
 * continue to where they were going.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  const response = await destination(request, user);
  // A brand-new account: the Meta Pixel fires CompleteRegistration once on the next page (src/components/meta-pixel.tsx).
  if (user && isNewSignup(user.created_at, Date.now())) {
    response.cookies.set(SIGNUP_COOKIE, await signupEventId(user.id), { path: "/", maxAge: NEW_ACCOUNT_MS / 1000, sameSite: "lax", secure: true });
  }
  return response;
}

async function destination(request: NextRequest, user: Awaited<ReturnType<typeof getSessionUser>>) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNext(searchParams.get("next"), origin);
  if (!user) return NextResponse.redirect(`${origin}/?auth=login`);
  try {
    const a = await allowance(user.id);
    if (!a.plan && a.limit !== null) {
      const billing = await billingRow(user.id);
      return NextResponse.redirect(`${origin}${billing?.status === "past_due" ? "/settings/billing" : "/pricing"}`);
    }
  } catch (error) {
    // Billing unavailable: do not block sign-in; the app asks for a plan when an AI step needs one.
    console.error("auth continue", error);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
