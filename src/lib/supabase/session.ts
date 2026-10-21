import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Runs in the proxy: refreshes the Supabase session cookie on every app and API request and guards them.
 * Signed out: app pages go to the landing page with the sign-up popup open (and come back after), the API answers 401 (the Business message box stays
 * open). Signed in, /login goes to the app. Without Supabase keys this is a passthrough, so the app still runs
 * locally with no accounts.
 */
const PUBLIC_API = ["/api/contact"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return request.nextUrl.pathname === "/login" ? NextResponse.redirect(new URL("/", request.url)) : response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // Verifies the JWT (and refreshes it near expiry).
  const { data } = await supabase.auth.getClaims();
  const signedIn = typeof data?.claims?.sub === "string";

  const { pathname, search } = request.nextUrl;
  // Redirects must carry any refreshed session cookies.
  const redirect = (to: URL) => {
    const r = NextResponse.redirect(to);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  // /login is the popup on the landing page.
  if (pathname === "/login") return redirect(new URL(signedIn ? "/studio" : "/?auth=login", request.url));
  if (pathname.startsWith("/api/")) {
    if (signedIn || PUBLIC_API.includes(pathname)) return response;
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!signedIn) {
    const to = new URL("/", request.url);
    to.searchParams.set("auth", "signup");
    to.searchParams.set("next", pathname + search);
    return redirect(to);
  }
  return response;
}
