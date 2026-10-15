import type { PartSound, Reference, Run, SoundPiece } from "@/lib/types";

/** Instagram shortcode of a reference ("DajwiOOtvDL"), the name of its file in .data/sources. */
export function shortcode(r: Reference): string | null {
  return /\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/.exec(r.sourceUrl ?? "")?.[1] ?? null;
}

/** Where a reference's sound plays from: its uploaded file, or the library video kept on disk. */
export function refSoundSrc(r: Reference): string | null {
  if (r.mediaId) return `/api/media/${r.mediaId}`;
  const code = shortcode(r);
  return code ? `/api/sounds/${code}` : null;
}

export const soundName = (r: Reference) => (r.author ? `@${r.author}` : r.title || "Viral sound");

/** Length of an audio (or video) file in seconds, read in the browser. */
export function audioLength(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => resolve(null);
    a.src = src;
  });
}

/** The song for the whole video (older runs from the split version keep their first piece). */
export function mainSound(run: Run): PartSound | null {
  const s = run.sound ?? run.sounds?.[0] ?? null;
  if (!s) return null;
  return { kind: s.kind, src: s.src, name: s.name, refId: s.refId, start: s.start, volume: s.volume, length: s.length };
}

/** The sound line in time order. Runs with a single `sound` read as one sound over the whole video. */
export function soundPieces(run: Run, total: number): SoundPiece[] {
  if (run.sounds?.length) return [...run.sounds].sort((a, b) => a.at - b.at);
  const main = mainSound(run);
  return main ? [{ ...main, id: "s1", at: 0, end: total }] : [];
}

/** Where sound i stops: its own end, the next sound's start, or the end of the video, whichever comes first. */
export const pieceEnd = (pieces: SoundPiece[], i: number, total: number) => Math.min(pieces[i].end ?? total, i + 1 < pieces.length ? pieces[i + 1].at : total, total);

/** Is any sound playing at video time t? (If not, the video's own sound is heard.) */
export const soundAtTime = (pieces: SoundPiece[], t: number, total: number) => pieces.some((p, i) => t >= p.at && t < pieceEnd(pieces, i, total));
