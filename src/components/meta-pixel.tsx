"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SIGNUP_COOKIE, pixelAllowed, readSignupCookie } from "@/lib/meta-pixel";

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; loaded: boolean; version: string; push: unknown };
declare global { interface Window { fbq?: Fbq; _fbq?: Fbq } }

/** Meta's standard loader, written out so nothing runs until the time-zone check passes. */
function load(id: string) {
  if (window.fbq) return;
  const fbq = function (...args: unknown[]) { if (fbq.callMethod) fbq.callMethod(...args); else fbq.queue.push(args); } as Fbq;
  fbq.push = fbq; fbq.loaded = true; fbq.version = "2.0"; fbq.queue = [];
  window.fbq = fbq; window._fbq = fbq;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  fbq("init", id);
}

/** PageView on each page, CompleteRegistration once after a new account's first sign-in (set by /auth/continue). */
export function MetaPixel({ id }: { id: string }) {
  const pathname = usePathname();
  useEffect(() => {
    const signup = readSignupCookie(document.cookie);
    // Read once: delete it whether or not the Pixel may run here.
    if (signup) document.cookie = `${SIGNUP_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    let zone: string | undefined;
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { zone = undefined; }
    if (!pixelAllowed(zone)) return;
    load(id);
    window.fbq?.("track", "PageView");
    if (signup) window.fbq?.("track", "CompleteRegistration", {}, { eventID: signup });
  }, [id, pathname]);
  return null;
}
