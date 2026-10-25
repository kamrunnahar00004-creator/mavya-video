import { safeNext } from "@/lib/auth-next";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Google sends people back here with a `code`: swap it for the session cookie, then continue to `next`.
 * `intent=login` (the popup's Log in tab): Google would create an account for an email it has never seen. Founder
 * 2026-10-25: Log in must not create accounts, so a brand-new account made by a Log in is removed again and the popup
 * says to sign up first. Sign up (and the email confirmation link, which has no intent) creates accounts as usual.
 */
const NEW_ACCOUNT_MS = 5 * 60_000;

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), origin);
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const user = data?.user;
      if (searchParams.get("intent") === "login" && user && justCreated(user.created_at, user.last_sign_in_at)) {
        await supabase.auth.signOut();
        const removed = await createSupabaseAdminClient().auth.admin.deleteUser(user.id);
        if (removed.error) console.error("login without an account: delete failed", user.id, removed.error.message);
        return NextResponse.redirect(`${origin}/?auth=signup&error=noaccount&next=${encodeURIComponent(next)}`);
      }
      return NextResponse.redirect(`${origin}/auth/continue?next=${encodeURIComponent(next)}`);
    }
  }
  return NextResponse.redirect(`${origin}/?auth=login&error=1`);
}

/** Made by this very sign-in: created moments ago, and its first sign-in is the same moment. */
function justCreated(created: string | undefined, lastSignIn: string | undefined): boolean {
  if (!created || !lastSignIn) return false;
  const c = new Date(created).getTime();
  const l = new Date(lastSignIn).getTime();
  return Date.now() - c < NEW_ACCOUNT_MS && Math.abs(l - c) < 10_000;
}
