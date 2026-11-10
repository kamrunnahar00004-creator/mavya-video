/**
 * Loads the account snapshot for Settings with one request at a time. A quiet load (a background refresh while the
 * last values show) never wins over a later real load: `load(false)` during a quiet one shows loading, waits for it,
 * and fetches again; only the newest request commits (Codex 2026-11-10).
 */
export function accountLoader<T>(fetchSnapshot: () => Promise<T>, ui: { begin: () => void; commit: (value: T) => void }) {
  let running: Promise<T> | null = null;
  let runningQuiet = false;
  let latest = 0;
  const start = (quiet: boolean, begun = false): Promise<T> => {
    if (!quiet && !begun) ui.begin();
    runningQuiet = quiet;
    const mine = ++latest;
    const operation = fetchSnapshot().then((value) => {
      if (mine === latest) ui.commit(value);
      return value;
    });
    running = operation;
    void operation.catch(() => undefined).finally(() => { if (running === operation) running = null; });
    return operation;
  };
  return (quiet: boolean): Promise<T> => {
    if (running) {
      if (quiet || !runningQuiet) return running;
      latest++;
      runningQuiet = false;
      ui.begin();
      const next = running.catch(() => undefined).then(() => start(false, true));
      running = next;
      void next.catch(() => undefined).finally(() => { if (running === next) running = null; });
      return next;
    }
    return start(quiet);
  };
}

/**
 * A value shared across mounts (the last profile, plan or usage) where only the newest request may write: take a
 * ticket when a request starts, write with it when it lands; a response older than one already written is dropped,
 * even from a component that has since unmounted (Codex 2026-11-10).
 */
export function newestWrites<T>() {
  let issued = 0;
  let written = 0;
  let value: T | null = null;
  return {
    get: () => value,
    ticket: () => ++issued,
    write: (ticket: number, next: T) => { if (ticket < written) return false; written = ticket; value = next; return true; },
  };
}
