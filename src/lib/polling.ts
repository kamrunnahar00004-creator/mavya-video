/** Keep healthy foreground cadence; reduce background/outage work without extra provider polls. */
export function pollDelay(base: number, failures = 0, hidden = false) {
  return hidden ? 30_000 : Math.min(30_000, base * 2 ** Math.min(4, failures));
}
export function waitForPoll(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visible);
      resolve();
    };
    const visible = () => { if (!document.hidden) done(); };
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", done, { once: true });
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visible);
  });
}
