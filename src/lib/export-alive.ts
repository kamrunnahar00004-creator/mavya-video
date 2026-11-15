// A browser export's upload, after the video is made in the browser (founder 2026-11-15: an export stayed "stuck"
// for 15 minutes after the page was changed to Scheduled posts while it was spinning). The upload now carries on
// when the run page is left (upload-put.ts, uploadWhileAlive), and tells the server it is alive every 15 s. A job
// whose browser stopped telling (tab closed or reloaded) ends 3 minutes later instead of 15. Shared by the page and
// the server (src/lib/server/export-jobs.ts).

/** How often a live upload tells the server. */
export const ALIVE_PING_MS = 15_000;
/** Silence after which the browser counts as gone (room for hidden tabs, whose timers may run once a minute). */
export const ALIVE_SILENT_MS = 3 * 60_000;
/** The longest a browser export may take to deliver, alive or not (its upload links last 15 minutes). */
export const BROWSER_MAX_MS = 15 * 60_000;

/**
 * True when a browser-lane job can no longer be delivered: past the 15 minutes, or it told the server it was alive
 * and then went quiet for 3 minutes. A job that never told (an older page, from before this rule) keeps the 15.
 */
export function browserGone(p: { laneAt?: unknown; aliveAt?: unknown }, now: number): boolean {
  const laneAt = typeof p.laneAt === "number" ? p.laneAt : 0;
  if (now - laneAt > BROWSER_MAX_MS) return true;
  return typeof p.aliveAt === "number" && now - p.aliveAt > ALIVE_SILENT_MS;
}

/** The job's progress for a reopened run page: the upload is the last 92% to 99% of an export. */
export function uploadProgress(sent: number): number {
  return Math.min(0.99, 0.92 + 0.07 * Math.min(1, Math.max(0, sent)));
}
