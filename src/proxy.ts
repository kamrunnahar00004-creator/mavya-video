import { NextResponse, type NextRequest } from "next/server";
import { MAINTENANCE } from "@/lib/maintenance";
import { updateSession } from "@/lib/supabase/session";
import { productionReady } from "@/lib/production-config";

/**
 * Every app page, sign-in route and API call passes through here.
 * Maintenance: app pages and sign-in go back to the landing page, API calls get 503 (the Business message box stays
 * open). Otherwise: the Supabase session is refreshed and signed-out visitors are sent to /login.
 */
export async function proxy(request: NextRequest) {
  if (!productionReady()) return new Response("Mavya is unavailable. Try again later.", { status: 503 });
  const { pathname } = request.nextUrl;
  if (MAINTENANCE) {
    if (pathname.startsWith("/api/")) {
      // Stripe keeps delivering plan changes during maintenance.
      if (["/api/contact", "/api/stripe/webhook", "/api/internal/generations"].includes(pathname)) return NextResponse.next();
      return Response.json({ error: "Mavya is under maintenance." }, { status: 503 });
    }
    return NextResponse.redirect(new URL("/", request.url));
  }
  // The OAuth callback sets the session itself.
  if (pathname.startsWith("/auth/")) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  matcher: ["/studio/:path*", "/library/:path*", "/settings/:path*", "/billing/:path*", "/api/:path*", "/login", "/auth/:path*"],
};
