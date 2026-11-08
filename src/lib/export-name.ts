/**
 * The file name a downloaded export saves as (founder 2026-11-08): the hook's first words, then the day and time it
 * was exported, like a phone names a recording: "my_app_had_only_nov8_214pm.mp4". Not random letters, so it does
 * not look mass-made; two videos whose hooks start the same still get different names from the time.
 */

const WORDS = 4;
const MAX_WORDS_CHARS = 40;
const FALLBACK = "mavya_video";

/** The hook text's first words, lower case, letters and digits only, joined by "_". */
export function hookWords(text: string | undefined): string {
  const plain = (text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!plain) return FALLBACK;
  let out = "";
  for (const word of plain.split(" ").slice(0, WORDS)) {
    const next = out ? `${out}_${word}` : word;
    if (next.length > MAX_WORDS_CHARS) break;
    out = next;
  }
  return out || plain.slice(0, MAX_WORDS_CHARS);
}

/** "nov8_214pm": the export's day and time in `timeZone` (the viewer's own when left out). */
export function exportStamp(at: string | Date, timeZone?: string): string {
  const when = typeof at === "string" ? new Date(at) : at;
  if (!Number.isFinite(when.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
      .formatToParts(when)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.month.toLowerCase()}${parts.day}_${parts.hour}${parts.minute}${parts.dayPeriod.toLowerCase()}`;
}

/** The export's file name without ".mp4". */
export function exportFileName(hookText: string | undefined, at: string | Date, timeZone?: string): string {
  const stamp = exportStamp(at, timeZone);
  return stamp ? `${hookWords(hookText)}_${stamp}` : hookWords(hookText);
}

/** The link that saves `src` as `name`.mp4 (a browser-made blob link is named by the <a download> attribute). */
export function downloadHref(src: string, name: string): string {
  if (src.startsWith("blob:")) return src;
  return `${src}${src.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;
}
