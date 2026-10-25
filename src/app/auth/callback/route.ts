import { safeNext } from "@/lib/auth-next";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";


/** Google sends people back here with a `code`: swap it for the session cookie, then continue to `next`. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/auth/continue?next=${encodeURIComponent(safeNext(searchParams.get("next"), origin))}`);
  }
  return NextResponse.redirect(`${origin}/?auth=login&error=1`);
}
