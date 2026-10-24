import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth-next";
import { allowance } from "@/lib/server/usage";
import { getSessionUser } from "@/lib/supabase/server";

/**
 * Where people land after signing in or signing up (password, Google or the email link).
 * Founder 2026-10-24: anyone without a plan goes to the pricing page (full comparison) to choose one; people with a plan (and admins)
 * continue to where they were going.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNext(searchParams.get("next"), origin);
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${origin}/?auth=login`);
  try {
    const a = await allowance(user.id);
    if (!a.plan && a.limit !== null) return NextResponse.redirect(`${origin}/pricing`);
  } catch (error) {
    // Billing unavailable: do not block sign-in; the app asks for a plan when an AI step needs one.
    console.error("auth continue", error);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
