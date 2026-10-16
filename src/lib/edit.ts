import type { Adjust } from "@/lib/adjust";
import { speedOf } from "@/lib/adjust";
const roundTime = (n: number) => Math.round(n * 1000) / 1000;
import type { DemoClip, Part, Reference, Run, TextLayer } from "@/lib/types";

/**
 * The finished video is one timeline: the hook, then the demo clips that have a video, in order.
 * Every clip is edited the same way (trim, speed, look, zoom keyframes); its on-screen length is
 * (end - start) / speed. Texts live on the whole timeline, in on-screen seconds.
 */
export type Seg = {
  /** "hook" or a demo clip id */
  id: string;
  label: string;
  /** Video file, or null for a placeholder (no hook yet). */
  src: string | null;
  /** Length of the file; trim points are inside it. */
  seconds: number;
  start: number;
  end: number;
  adjust?: Partial<Adjust>;
  /** Hook only: speed / look apply once the hook is generated. */
  editable: boolean;
  /** The pieces that play, back to back (one piece until the clip is Cut). start / end = the first and last frame used. */
  parts: Part[];
  /** Timeline position and on-screen length. */
  offset: number;
  len: number;
};

/** A clip's pieces; a clip that was never Cut is one piece from start to end. */
export const partsOf = (x: { start: number; end: number; parts?: Part[] }): Part[] => (x.parts?.length ? x.parts : [{ id: "p0", start: x.start, end: x.end }]);

/** start / end / parts to store for a clip with these pieces (one piece = no parts list). */
export const storeParts = (parts: Part[]) => ({
  start: Math.min(...parts.map((p) => p.start)),
  end: Math.max(...parts.map((p) => p.end)),
  parts: parts.length > 1 ? parts : undefined,
});

const pieceLen = (p: Part, speed: number) => Math.max(0.05, p.end - p.start) / speed;
export const segSpeed = (s: Pick<Seg, "editable" | "adjust">) => (s.editable ? speedOf(s.adjust) : 1);

/** Where each piece starts on screen (from the clip's start), and how long it plays. */
export function pieceSpans(s: Pick<Seg, "parts" | "editable" | "adjust">): { at: number; len: number }[] {
  const sp = segSpeed(s);
  let at = 0;
  return s.parts.map((p) => {
    const len = pieceLen(p, sp);
    const span = { at, len };
    at += len;
    return span;
  });
}

/** The file time (and piece) shown at on-screen time `rel` from the clip's start. */
export function fileAt(s: Pick<Seg, "parts" | "editable" | "adjust">, rel: number): { file: number; i: number } {
  const sp = segSpeed(s);
  const spans = pieceSpans(s);
  let i = spans.findIndex((x) => rel < x.at + x.len);
  if (i < 0) i = spans.length - 1;
  const p = s.parts[i];
  return { file: Math.max(p.start, Math.min(p.end, p.start + (rel - spans[i].at) * sp)), i };
}

/** On-screen time (from the clip's start) where file time `file` shows, or null when that frame was cut away. */
export function relAt(s: Pick<Seg, "parts" | "editable" | "adjust">, file: number): number | null {
  const sp = segSpeed(s);
  const spans = pieceSpans(s);
  const i = s.parts.findIndex((p) => file >= p.start - 0.001 && file <= p.end + 0.001);
  return i < 0 ? null : spans[i].at + Math.max(0, file - s.parts[i].start) / sp;
}

/** Where a demo clip's video plays from: its own file, or its upload; null while it has no video yet. */
export const clipSrc = (c: DemoClip): string | null => c.src ?? (c.mediaId ? `/api/media/${c.mediaId}` : null);

/** Demo clips of a run; older runs with a single demo clip read as one clip. */
export function demoClips(run: Run): DemoClip[] {
  if (run.demo.clips) return run.demo.clips;
  const c = run.demo.clip;
  if (c?.mediaId && c.kind === "video") return [{ id: "demo", label: "Your demo", mediaId: c.mediaId, name: c.name, seconds: c.length ?? 3, start: 0, end: c.length ?? 3 }];
  return [];
}

export const segLen = (s: { start: number; end: number; adjust?: Partial<Adjust> }) => Math.max(0.1, s.end - s.start) / speedOf(s.adjust);

/** The run's timeline: the hook, then the demo clips that have a video. No demo yet = just the hook. */
export function timeline(run: Run, source: Reference | null): Seg[] {
  const h = run.hook;
  const hookSrc = h.generated?.src ?? (h.clip?.mediaId ? `/api/media/${h.clip.mediaId}` : source?.mediaId ? `/api/media/${source.mediaId}` : null);
  const segs: (Omit<Seg, "offset" | "len" | "parts"> & { parts?: Part[] })[] = [
    h.generated
      ? { id: "hook", label: "Hook", src: hookSrc, seconds: h.generated.seconds, start: h.start ?? 0, end: h.end ?? h.generated.seconds, parts: partsOf({ start: h.start ?? 0, end: h.end ?? h.generated.seconds, parts: h.parts }), adjust: h.adjust, editable: true }
      : { id: "hook", label: "Hook", src: hookSrc, seconds: h.end ?? 3, start: h.clip ? 0 : (h.start ?? 0), end: h.clip ? Math.max(0.5, (h.end ?? 3) - (h.start ?? 0)) : (h.end ?? 3), editable: false },
  ];
  const clips = demoClips(run).filter((c) => clipSrc(c));
  clips.forEach((c, i) => {
    const seconds = c.seconds ?? 3;
    segs.push({ id: c.id, label: clips.length > 1 ? `${i + 1}. ${c.label}` : c.label, src: clipSrc(c), seconds, start: c.start ?? 0, end: c.end ?? seconds, parts: partsOf({ start: c.start ?? 0, end: c.end ?? seconds, parts: c.parts }), adjust: c.adjust, editable: true });
  });
  let at = 0;
  return segs.map((s) => {
    const parts = s.parts ?? [{ id: "p0", start: s.start, end: s.end }];
    const len = s.editable ? parts.reduce((t, p) => t + pieceLen(p, speedOf(s.adjust)), 0) : Math.max(0.5, s.end - s.start);
    const seg = { ...s, parts, offset: at, len };
    at += len;
    return seg;
  });
}

type Window = { start: number; end: number; speed: number };

/**
 * Re-times texts after one clip (at timeline `offset`) changes its trim or speed.
 * Texts before it stay, texts after it shift, texts inside it follow the same frames.
 * Edges that sat on the clip's start or end stay on them (a text over the whole clip keeps covering it).
 */
export function retimeTexts(texts: TextLayer[], offset: number, from: Window, to: Window): TextLayer[] {
  const oldLen = Math.max(0.1, from.end - from.start) / from.speed;
  const newLen = Math.max(0.1, to.end - to.start) / to.speed;
  const map = (x: number) => {
    if (x < offset - 0.05) return x;
    if (Math.abs(x - offset) <= 0.05) return offset;
    if (Math.abs(x - (offset + oldLen)) <= 0.05) return offset + newLen;
    if (x > offset + oldLen) return x - oldLen + newLen;
    const file = from.start + (x - offset) * from.speed;
    return offset + Math.max(0, Math.min(newLen, (file - to.start) / to.speed));
  };
  return texts.map((t) => {
    const start = roundTime(map(t.start));
    let end = roundTime(map(t.end));
    if (end - start < 0.3) end = roundTime(start + 0.3);
    return { ...t, start, end };
  });
}

type Pieces = { parts: Part[]; speed: number };

/**
 * Re-times texts after one clip (at timeline `offset`) changes its pieces or speed (Cut, trim or delete a
 * piece, Undo). Texts before it stay, texts after it shift, edges inside it follow the same frames, edges on
 * the clip's start or end stay on them. An edge on a frame that was cut away lands where that frame was.
 */
export function remapTexts(texts: TextLayer[], offset: number, from: Pieces, to: Pieces): TextLayer[] {
  const oldL = from.parts.map((p) => pieceLen(p, from.speed));
  const newL = to.parts.map((p) => pieceLen(p, to.speed));
  const sum = (l: number[], n = l.length) => l.slice(0, n).reduce((a, x) => a + x, 0);
  const oldLen = sum(oldL);
  const newLen = sum(newL);
  const map = (x: number) => {
    if (x < offset - 0.05) return x;
    if (Math.abs(x - offset) <= 0.05) return offset;
    if (Math.abs(x - (offset + oldLen)) <= 0.05) return offset + newLen;
    if (x > offset + oldLen) return x - oldLen + newLen;
    let rel = x - offset;
    let i = 0;
    while (i < oldL.length - 1 && rel > oldL[i]) rel -= oldL[i++];
    const p = from.parts[i];
    const file = p.start + rel * from.speed;
    const has = (q: Part) => file >= q.start - 0.01 && file <= q.end + 0.01;
    let j = to.parts.findIndex((q) => q.id === p.id && has(q));
    if (j < 0) j = to.parts.findIndex(has);
    if (j >= 0) return offset + sum(newL, j) + Math.max(0, Math.min(newL[j], (file - to.parts[j].start) / to.speed));
    const k = to.parts.findIndex((q) => q.id === p.id);
    if (k >= 0) return offset + sum(newL, k) + (file < to.parts[k].start ? 0 : newL[k]);
    for (let n = i + 1; n < from.parts.length; n++) {
      const m = to.parts.findIndex((q) => q.id === from.parts[n].id);
      if (m >= 0) return offset + sum(newL, m);
    }
    return offset + newLen;
  };
  return texts.map((t) => {
    const start = roundTime(map(t.start));
    let end = roundTime(map(t.end));
    if (end - start < 0.3) end = roundTime(start + 0.3);
    return { ...t, start, end };
  });
}

/** Removes a clip of on-screen length `len` at `offset`: texts only inside it go, later texts move up. */
export function cutOutTexts(texts: TextLayer[], offset: number, len: number): TextLayer[] {
  const out: TextLayer[] = [];
  for (const t of texts) {
    if (t.start >= offset - 0.05 && t.end <= offset + len + 0.05 && t.id !== "hook") continue;
    const map = (x: number) => (x <= offset ? x : x >= offset + len ? x - len : offset);
    const start = roundTime(map(t.start));
    const end = roundTime(Math.max(start + 0.3, map(t.end)));
    out.push({ ...t, start, end });
  }
  return out;
}

/** Shot list for "Build it clip by clip": from the hook's analysis when there is one, else a proven default
 *  for the reaction + demo format (phone filming the laptop). Suggested texts are samples until the AI writes them per product. */
export function shotList(source: Reference | null): Omit<DemoClip, "id">[] {
  const fromRecipe = source?.recipe?.demo;
  if (fromRecipe?.length) return fromRecipe.map((s) => ({ label: s.label, hint: s.hint, target: s.seconds, camera: s.camera, steps: s.steps, text: s.text }));
  return [
    { label: "Show the problem", target: 2, camera: "Over your shoulder, screen fills the frame", steps: ["Open the old, messy way", "Scroll so it looks endless"], text: "doing this by hand again 😩" },
    { label: "Open your product", target: 1.5, camera: "Same angle, phone steady", steps: ["Open your site or app", "Let it fully load"], text: "then I found this" },
    { label: "The magic moment", target: 3, camera: "Closer, button in frame", steps: ["Click the main button", "Film until the result shows"], text: "one click..." },
    { label: "The result", target: 2, camera: "Slow push in", steps: ["Scroll the finished result", "End on the best part"], text: "how is this free 😭" },
  ];
}

/** The five steps of a video, done or not, in order (the run page and the videos grid both use this). */
export function runSteps(run: Run): boolean[] {
  const h = run.hook;
  const hasDemo = demoClips(run).some((c) => clipSrc(c));
  const hasSound = run.sounds ? run.sounds.length > 0 : Boolean(run.sound);
  return [Boolean(run.sourceRefId) || Boolean(h.source === "describe" && h.describeReady && h.describe?.trim()), Boolean(h.face), Boolean(h.generated), hasDemo, hasSound];
}
