import { stopRecovery, validStop } from "@/lib/server/checkout-recovery";

/**
 * The unsubscribe link in the checkout recovery emails (signed per user). GET only shows a button; the POST it sends
 * unsubscribes (Codex 2026-11-27: email scanners open links, and must not unsubscribe anyone).
 */
const page = (body: string, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mavya</title><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#111;font-size:17px">${body}</body>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const BAD = "<p>This link doesn't look right. Email hello@mavya.app and we'll take you off the list.</p>";

function read(request: Request) {
  const url = new URL(request.url);
  return { user: url.searchParams.get("u") ?? "", token: url.searchParams.get("t") ?? "" };
}

export async function GET(request: Request) {
  const { user, token } = read(request);
  if (!validStop(user, token)) return page(BAD, 400);
  return page(`<p>Stop getting these emails from Mavya?</p><form method="post"><button type="submit" style="font:inherit;font-weight:600;background:#111;color:#fff;border:0;border-radius:8px;padding:12px 22px;cursor:pointer">Unsubscribe</button></form>`);
}

export async function POST(request: Request) {
  const { user, token } = read(request);
  if (!validStop(user, token)) return page(BAD, 400);
  try {
    await stopRecovery(user);
    return page("<p>Done. You won't get these emails again.</p>");
  } catch (error) {
    console.error("email stop", error);
    return page("<p>Something went wrong. Email hello@mavya.app and we'll take you off the list.</p>", 503);
  }
}
