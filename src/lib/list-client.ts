/** A page has the same array shape as before; continuation is explicit, never an implicit cap. */
export async function fetchPage<T>(url: string, cursor?: string | null): Promise<{items: T[]; next: string | null}> {
  const res = await fetch(url + (cursor ? (url.includes("?") ? "&" : "?") + "cursor=" + encodeURIComponent(cursor) : ""));
  if (!res.ok) throw Error("List is unavailable. Try again.");
  const items = await res.json();
  if (!Array.isArray(items)) throw Error("List is unavailable. Try again.");
  return { items, next: res.headers.get("X-Next-Cursor") };
}
/** Only for the explicitly opened history, which needs all previous versions for reuse. */
export async function fetchHistory<T>(url: string): Promise<T[]> {
  const all: T[] = [];
  let next: string | null = null;
  do { const page: {items: T[]; next: string | null} = await fetchPage<T>(url, next); all.push(...page.items); next = page.next; } while (next);
  return all;
}
