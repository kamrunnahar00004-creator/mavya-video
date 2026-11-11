/**
 * How long until every clip of an export has its working copy (src/lib/server/previews.ts), for the Export button's
 * "Preparing" timer (founder 2026-11-11: "until it is ready, keep on spinning with an estimated timer; only when it is
 * fully ready can one click Export"). The render server makes copies one at a time, oldest upload first. Measured on
 * production 2026-11-11 (iPhone 4K HDR .mov, the slowest kind): 34.2 MB took 147 s and 38.9 MB took 167 s, about
 * 4.3 s per MB. SDR clips are faster, so the timer errs long, and it never claims a copy is done before it is.
 */
export const COPY_SECONDS_PER_MB = 4.3;
/** At least this long per copy (download, start, upload). */
export const COPY_MIN_SECONDS = 15;
/** Shown once the estimate has run out but the copy is not there yet. */
export const COPY_ALMOST_SECONDS = 10;

export type PendingCopy = { size: number; uploadedAt: number };

/** Seconds of one copy for a file of `size` bytes. */
export const copySeconds = (size: number) => Math.max(COPY_MIN_SECONDS, (size / 1_048_576) * COPY_SECONDS_PER_MB);

/** Seconds from `now` (ms) until the last pending copy is made: copies run one after another from their uploads. */
export function copyEta(pending: PendingCopy[], now: number): number {
  if (!pending.length) return 0;
  let finish = 0;
  for (const p of [...pending].sort((a, b) => a.uploadedAt - b.uploadedAt)) finish = Math.max(finish, p.uploadedAt) + copySeconds(p.size) * 1000;
  return Math.max(COPY_ALMOST_SECONDS, Math.ceil((finish - now) / 1000));
}

/** "about 2:30 left" / "almost ready" for the button. */
export function copyEtaLabel(seconds: number): string {
  if (seconds <= COPY_ALMOST_SECONDS) return "Almost ready";
  const s = Math.ceil(seconds / 5) * 5;
  return `~${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`;
}

/** The uploaded clips an export reads ("/api/media/<id>"), without the hook (it exports from its own file). */
export function exportUploads(segments: { id: string; src?: string | null }[]): string[] {
  const ids = segments.filter((s) => s.id !== "hook").map((s) => /^\/api\/media\/([^/?#]+)$/.exec(s.src ?? "")?.[1]).filter((x): x is string => Boolean(x));
  return [...new Set(ids)];
}
