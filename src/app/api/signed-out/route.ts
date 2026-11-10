/**
 * Sign-out clears this browser's HTTP cache for mavya.app, so the saved hook library (cached by the browser for
 * speed, see /api/references) never outlives the session. Public: it only touches the caller's own browser.
 */
export function POST() {
  return new Response(null, { status: 204, headers: { "Clear-Site-Data": '"cache"', "Cache-Control": "no-store" } });
}
