/**
 * In-app browsers (founder 2026-11-26: ad visitors must open Mavya in their real browser, not inside Instagram).
 * Inside Instagram, Facebook or TikTok, Google blocks its sign-in (disallowed_useragent) and Apple Pay is often missing.
 * Detection is by user agent; nothing here runs in a normal browser.
 */

export type InApp = { app: "Instagram" | "Facebook" | "TikTok" | "Threads" | "Snapchat" | "LinkedIn"; os: "ios" | "android" | "other" };

export function inAppBrowser(ua: string): InApp | null {
  const app = /Instagram/i.test(ua) ? "Instagram"
    : /Barcelona/i.test(ua) ? "Threads"
    : /\bFBAN\/|\bFBAV\/|\bFB_IAB\/|\bFBIOS\b/i.test(ua) ? "Facebook"
    : /musical_ly|BytedanceWebview|\bTikTok\b|trill_/i.test(ua) ? "TikTok"
    : /Snapchat/i.test(ua) ? "Snapchat"
    : /LinkedInApp/i.test(ua) ? "LinkedIn"
    : null;
  if (!app) return null;
  const os = /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "other";
  return { app, os };
}

/**
 * A link that leaves the in-app browser for the real one, keeping the page and its query (the ad's fbclid and UTMs, so
 * the visit still counts for the ad). Android: Chrome by intent, falling back to the same page. iPhone Instagram:
 * Instagram's own "open outside" link (founder 2026-11-27: Instagram blocks Safari's scheme since about March 2026;
 * this one shows Instagram's confirm box, one tap opens the default browser; it must come from a tap). Other iPhone
 * apps: Safari's own scheme (iOS 17 and later where the app allows it). Null for an address that isn't http(s).
 */
export function openInBrowserUrl(href: string, os: InApp["os"], app?: InApp["app"]): string | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const rest = `${u.host}${u.pathname}${u.search}`;
  if (os === "android") return `intent://${rest}#Intent;scheme=${u.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.toString())};end`;
  if (os === "ios" && app === "Instagram") return `instagram://extbrowser/?url=${encodeURIComponent(u.toString())}`;
  if (os === "ios") return `x-safari-${u.protocol.slice(0, -1)}://${rest}`;
  return null;
}
