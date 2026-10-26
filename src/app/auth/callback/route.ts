import { safeNext } from "@/lib/auth-next";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RESET = "/reset-password";

/**
 * Google and the password-reset email send people back here. A `code` (same browser) or a `token_hash` (the reset
 * email template, works on any device) becomes the session cookie. A reset goes straight to /reset-password, never
 * through /auth/continue (which sends accounts without a plan to Pricing); everything else continues to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const next = safeNext(searchParams.get("next"), origin);
  const reset = next === RESET || searchParams.get("type") === "recovery";
  if (code || tokenHash) {
    const supabase = await createSupabaseServerClient();
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
      : await supabase.auth.exchangeCodeForSession(code!);
    if (!error) return NextResponse.redirect(reset ? `${origin}${RESET}` : `${origin}/auth/continue?next=${encodeURIComponent(next)}`);
  }
  return NextResponse.redirect(reset ? `${origin}${RESET}?expired=1` : `${origin}/?auth=login&error=1`);
}
