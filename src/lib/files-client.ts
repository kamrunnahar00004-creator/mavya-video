import type { FileSources } from "@/lib/my-files";

/**
 * My files' list, kept for the page (founder 2026-11-09: My files must open instantly). Hovering the My files button
 * starts the read, so it is usually there by the click; the panel shows the last list at once and refreshes it.
 */
let last: FileSources | null = null;
let reading: Promise<FileSources> | null = null;

/** The list as last read, if any. */
export const peekFiles = () => last;

/** Reads the list (one read at a time; `fresh` starts a new one even if one finished before). */
export function loadFiles(fresh = false): Promise<FileSources> {
  if (reading && !fresh) return reading;
  if (last && !fresh) return Promise.resolve(last);
  const read = fetch("/api/files", { signal: AbortSignal.timeout(20_000) })
    .then(async (r) => { if (!r.ok) throw Error("List is unavailable. Try again."); return (await r.json()) as FileSources; })
    .then((s) => { last = s; return s; })
    .finally(() => { if (reading === read) reading = null; });
  reading = read;
  return read;
}
