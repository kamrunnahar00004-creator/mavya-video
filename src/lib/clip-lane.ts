/**
 * Which texts a clip's own lane lists (the clip editor's text bars), in clip time. Founder 2026-11-23: a text that
 * only grazed the clip's edge (crossing it by a fraction of a second, so it belongs to the next or previous clip)
 * showed as a squashed sliver hanging past the end of the lane. A text is listed when it covers at least
 * MIN_OVERLAP seconds of the clip, or when it lies wholly inside the clip (a deliberately short text).
 * Pure; tested in scripts/clip-lane-checks.cjs.
 */
export const MIN_OVERLAP = 0.25;

export function clipTexts<T extends { start: number; end: number }>(texts: T[], offset: number, len: number): T[] {
  const end = offset + len;
  return texts
    .filter((x) => {
      const overlap = Math.min(x.end, end) - Math.max(x.start, offset);
      if (overlap <= 0.05) return false;
      const inside = x.start >= offset - 0.001 && x.end <= end + 0.001;
      return overlap >= MIN_OVERLAP || inside;
    })
    .map((x) => ({ ...x, start: Math.max(0, x.start - offset), end: Math.min(len, x.end - offset) }));
}
