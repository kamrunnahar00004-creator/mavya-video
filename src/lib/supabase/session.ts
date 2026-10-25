import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Runs in the proxy: refreshes the Supabase session cookie on every app and API request and guards them.
 * Signed out: app pages go to the landing page with the sign-up popup open (and come back after), the API answers 401 (the Business message box stays
 * open). Signed in, /login goes to the app. Without Supabase keys this is a passthrough, so the app still runs
 * locally with no accounts.
 */
const PUBLIC_API = ["/api/contact", "/api/stripe/webhook", "/api/internal/generations"];

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

  const denied = (body: object, status: number) => {
    const r = NextResponse.json(body, { status });
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };
  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API.includes(pathname)) return response;
    if (!signedIn) return denied({ error: "Sign in first." }, 401);
    // Uploads and exports cost storage and render time: paid plans only (AI routes check their own allowance).
    if (PAID_API.some((p) => p.test(pathname)) && !(await paid(data!.claims.sub as string, data!.claims.email))) {
      return denied({ error: "Choose a plan to continue.", needsPlan: true }, 402);
    }
    return response;
  }
  if (!signedIn) {
    const to = new URL("/", request.url);
    to.searchParams.set("auth", "signup");
    to.searchParams.set("next", pathname + search);
    return redirect(to);
  }
  // Founder rule 2026-10-25: nothing leads into the app without a paid plan. Unpaid accounts only see Pricing (and
  // Settings, to manage billing and their profile). Admins (ADMIN_EMAILS) are always in.
  if ((pathname === "/login" || APP_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) && !(await paid(data!.claims.sub as string, data!.claims.email))) {
    return redirect(new URL("/pricing", request.url));
  }
  if (pathname === "/login") return redirect(new URL("/studio", request.url));
  return response;
}

const APP_PAGES = ["/studio", "/library"];
const PAID_API = [/^\/api\/uploads(\/|$)/, /^\/api\/media\/?$/, /^\/api\/runs\/[^/]+\/export(\/|$)/];

/** Has a usable plan (the same allowance the AI routes use), or is an admin. Fails closed: unknown means unpaid. */
async function paid(user: string, email: unknown): Promise<boolean> {
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (typeof email === "string" && admins.includes(email.toLowerCase())) return true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return false;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/mavya_allowance`, {
      method: "POST",
      headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" },
      body: JSON.stringify({ p_user: user, p_admin: false }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const a = (await res.json()) as { plan?: string | null };
    return Boolean(a?.plan);
  } catch {
    return false;
  }
}
