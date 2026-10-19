import { NextResponse, type NextRequest } from "next/server";
import { MAINTENANCE } from "@/lib/maintenance";

/** During maintenance: app pages go back to the landing page, API calls get 503 (the Business message box stays open). */
export function proxy(request: NextRequest) {
  if (!MAINTENANCE) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/contact") return NextResponse.next();
    return Response.json({ error: "Mavya is under maintenance." }, { status: 503 });
  }
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/studio/:path*", "/library/:path*", "/settings/:path*", "/billing/:path*", "/api/:path*"],
};
