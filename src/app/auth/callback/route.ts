import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Only same-origin paths may be a destination after sign-in. */
function safeNext(raw: string | null, origin: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/studio";
  try {
    const parsed = new URL(raw, origin);
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}` : "/studio";
  } catch {
    return "/studio";
  }
}

/** Google sends people back here with a `code`: swap it for the session cookie, then continue to `next`. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"), origin)}`);
  }
  return NextResponse.redirect(`${origin}/login?error=1`);
}
