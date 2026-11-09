/**
 * The Export button's timer (founder 2026-11-09: "1 minute is fine as long as there is a timer"). Counts down from
 * about one minute; past it, says it is almost done and keeps counting the real time, never a frozen or negative clock.
 */
export const EXPORT_ESTIMATE = 60;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The button's words while exporting: seconds since Export was clicked, progress 0-1. */
export function exportClockLabel(elapsed: number, progress: number): string {
  const e = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const pct = progress > 0.03 ? `${Math.round(Math.min(1, progress) * 100)}% · ` : "";
  const left = EXPORT_ESTIMATE - e;
  return left > 0 ? `${pct}${clock(Math.ceil(left))} left` : `${pct}Almost done ${clock(e)}`;
}
