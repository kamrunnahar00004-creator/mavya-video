import type { Adjust } from "@/lib/adjust";
import { speedOf } from "@/lib/adjust";
const roundTime = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Whether a text shows at time t (end exclusive). Text times are saved to the millisecond and clip edges are not,
 * so a caption made for a clip can start a fraction of a millisecond after it: within 1 ms counts as the same moment.
 */
export const showsAt = (x: { start: number; end: number }, t: number) => t >= x.start - 0.001 && t < x.end - 0.001;
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
  /** Empty space before it (black), seconds (the editor's magnet off). */
  gap: number;
  /** Timeline position and on-screen length. */
  offset: number;
  len: number;
};

/** Length of the whole video (the end of the last clip, gaps included). */
export const videoLength = (segs: Seg[]) => (segs.length ? segs[segs.length - 1].offset + segs[segs.length - 1].len : 0);

/** The clip playing at `time`, or null in an empty space. */
export const segAt = (segs: Seg[], time: number) => segs.find((x) => time >= x.offset && time < x.offset + x.len) ?? null;

/** A clip's pieces; a clip that was never Cut is one piece from start to end. */
export const partsOf = (x: { start: number; end: number; parts?: Part[] }): Part[] => (x.parts?.length ? x.parts : [{ id: "p0", start: x.start, end: x.end }]);

/** start / end / parts to store for a clip with these pieces (one piece = no parts list). */
export const storeParts = (parts: Part[]) => ({
  start: Math.min(...parts.map((p) => p.start)),
  end: Math.max(...parts.map((p) => p.end)),
  parts: parts.length > 1 || parts[0]?.id !== "p0" ? parts : undefined,
});

const pieceLen = (p: Part, speed: number) => Math.max(0.05, p.end - p.start) / speed;

/**
 * The look and sound of piece i of a clip: the piece's own settings over the clip's (founder 2026-11-03: settings
 * apply to the selected piece). Speed is always the clip's, so every piece keeps its place on the timeline.
 */
export function pieceAdjust(s: Pick<Seg, "parts" | "adjust">, i: number): Partial<Adjust> | undefined {
  const own = s.parts[i]?.adjust;
  if (!own) return s.adjust;
  return { ...s.adjust, ...own, speed: s.adjust?.speed ?? 1 };
}
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
      ? { id: "hook", label: "Hook", src: hookSrc, seconds: h.generated.seconds, start: h.start ?? 0, end: h.end ?? h.generated.seconds, parts: partsOf({ start: h.start ?? 0, end: h.end ?? h.generated.seconds, parts: h.parts }), adjust: h.adjust, editable: true, gap: 0 }
      : { id: "hook", label: "Hook", src: hookSrc, seconds: h.end ?? 3, start: h.clip ? 0 : (h.start ?? 0), end: h.clip ? Math.max(0.5, (h.end ?? 3) - (h.start ?? 0)) : (h.end ?? 3), editable: false, gap: 0 },
  ];
  const clips = demoClips(run).filter((c) => clipSrc(c));
  clips.forEach((c, i) => {
    const seconds = c.seconds ?? 3;
    segs.push({ id: c.id, label: clips.length > 1 ? `${i + 1}. ${c.label}` : c.label, src: clipSrc(c), seconds, start: c.start ?? 0, end: c.end ?? seconds, parts: partsOf({ start: c.start ?? 0, end: c.end ?? seconds, parts: c.parts }), adjust: c.adjust, editable: true, gap: Math.max(0, c.gap ?? 0) });
  });
  let at = 0;
  return segs.map((s) => {
    const parts = s.parts ?? [{ id: "p0", start: s.start, end: s.end }];
    const len = s.editable ? parts.reduce((t, p) => t + pieceLen(p, speedOf(s.adjust)), 0) : Math.max(0.5, s.end - s.start);
    at += s.gap;
    const seg = { ...s, parts, offset: at, len };
    at += len;
    return seg;
  });
}

/**
 * Text edges that sit a hair off a clip's start or end (older texts were rounded to 0.1s while clips are placed to
 * the millisecond) snap onto it, so a caption starts and ends exactly with its clip. Returns the same array when
 * nothing moved.
 */
export function snapTexts(texts: TextLayer[], segs: Seg[], tol = 0.08): TextLayer[] {
  const edges = segs.flatMap((s) => [s.offset, s.offset + s.len]).map(roundTime);
  const snap = (x: number) => edges.find((e) => Math.abs(e - x) <= tol && Math.abs(e - x) > 0.0005) ?? x;
  let moved = false;
  const next = texts.map((t) => {
    const start = snap(t.start);
    const end = snap(t.end);
    if (start === t.start && end === t.end) return t;
    if (end - start < 0.3) return t;
    moved = true;
    return { ...t, start, end };
  });
  return moved ? next : texts;
}

/**
 * A text belongs to the clip it starts in and never runs past that clip's end (founder 2026-11-07: a hook caption
 * showed over the next clip after the hook was trimmed). A text starting in a gap ends where the next clip starts;
 * one past the video is left alone. Which clip a text starts in is judged in milliseconds, as starts are saved (a
 * start of 2.345 on an edge at 2.34545 is the next clip's), while the end is clamped to the exact edge: the export
 * rounds both to frames the same way, and a rounded edge could show the text on the next clip's first frame (Codex
 * 2026-11-07). Returns `texts` itself when nothing changes.
 */
export function ownedBy(start: number, offset: number, len: number): boolean {
  const at = roundTime(start);
  return at >= roundTime(offset) && at < roundTime(offset + len);
}
/**
 * Which clip a text belongs to, as containTexts judges it: `seg` is the clip's index in `segs`; `gap` when the text
 * starts in the empty space before that clip. null: before the first clip or past the last. The export puts the text
 * on that clip's frames (render.mjs textFrames), so it never re-judges ownership from its own sums.
 */
export function textOwner(start: number, segs: Seg[]): { seg: number; gap: boolean } | null {
  const own = segs.findIndex((s) => ownedBy(start, s.offset, s.len));
  if (own >= 0) return { seg: own, gap: false };
  const next = segs.findIndex((s) => roundTime(s.offset) > roundTime(start));
  return next >= 0 && gapHolds(segs[next], start) ? { seg: next, gap: true } : null;
}
const gapHolds = (s: Seg, start: number) => s.gap > 0 && roundTime(start) >= roundTime(s.offset - s.gap);
/**
 * A start this little before a clip's start (under one frame) is rounding drift, not a choice: re-timing after a
 * trim and then a speed change put "pick AI face" at 6.288 on a clip starting at 6.289, the text was judged the
 * previous clip's, cut to 1 ms and lost with every other text after the hook (founder 2026-11-12: "after generation
 * where did all my subtitles go?"). Such a start moves onto the clip's edge, so the text stays on its clip.
 */
export const EDGE_DRIFT = 0.02;
export function containTexts(texts: TextLayer[], segs: Seg[]): TextLayer[] {
  let moved = false;
  const next = texts.map((t) => {
    const edge = segs.find((s) => { const d = roundTime(s.offset) - roundTime(t.start); return d > 0 && d <= EDGE_DRIFT + 1e-9 && t.end > s.offset + EDGE_DRIFT; });
    const start = edge ? roundTime(edge.offset) : t.start;
    const seg = segs.find((s) => ownedBy(start, s.offset, s.len));
    const end = seg ? seg.offset + seg.len : segs.find((s) => roundTime(s.offset) > roundTime(start))?.offset;
    const clamp = end !== undefined && t.end > end;
    if (start === t.start && !clamp) return t;
    moved = true;
    return { ...t, start, end: clamp ? end : t.end };
  });
  return moved ? next : texts;
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
    let start = roundTime(map(t.start));
    let end = roundTime(map(t.end));
    // A text of this clip stays on it: one whose frames were cut away keeps the clip's last 0.3 s, never the next
    // clip (Codex 2026-11-07: a shorter regenerated hook moved a hook caption onto the demo).
    const own = ownedBy(t.start, offset, oldLen);
    if (own && start > offset + newLen - 0.3) start = roundTime(Math.max(offset, offset + newLen - 0.3));
    if (end - start < 0.3) end = roundTime(start + 0.3);
    if (own) end = Math.min(end, offset + newLen);
    return { ...t, start, end };
  });
}

type Pieces = { parts: Part[]; speed: number };

/**
 * Re-times texts after one clip (at timeline `offset`) changes its pieces or speed (Cut, trim or delete a
 * piece, Undo). Texts before it stay, texts after it shift, edges inside it follow the same frames, edges on
 * the clip's start or end stay on them. An edge on a frame that was cut away lands where that frame was.
 */
export function remapTexts(texts: TextLayer[], offset: number, from: Pieces, to: Pieces, keepAfter = false): TextLayer[] {
  const oldL = from.parts.map((p) => pieceLen(p, from.speed));
  const newL = to.parts.map((p) => pieceLen(p, to.speed));
  const sum = (l: number[], n = l.length) => l.slice(0, n).reduce((a, x) => a + x, 0);
  const oldLen = sum(oldL);
  const newLen = sum(newL);
  // keepAfter (magnet off): what comes after the clip stays where it is.
  const map = (x: number, isStart: boolean) => {
    if (x < offset - 0.05) return x;
    if (Math.abs(x - offset) <= 0.05) return offset;
    if (keepAfter && isStart && x >= offset + oldLen - 0.05) return x;
    if (Math.abs(x - (offset + oldLen)) <= 0.05) return offset + newLen;
    if (x > offset + oldLen) return keepAfter ? x : x - oldLen + newLen;
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
  return texts.flatMap((t) => {
    const start = roundTime(map(t.start, true));
    const end = roundTime(map(t.end, false));
    // Deleted frames must not turn into an invented 0.3s subtitle on the next clip.
    return end > start ? [{ ...t, start, end }] : [];
  });
}

/** Removes a clip of on-screen length `len` at `offset`: texts only inside it go, later texts move up. */
export function cutOutTexts(texts: TextLayer[], offset: number, len: number): TextLayer[] {
  const out: TextLayer[] = [];
  for (const t of texts) {
    if (t.start >= offset - 0.05 && t.end <= offset + len + 0.05) continue;
    const map = (x: number) => (x <= offset ? x : x >= offset + len ? x - len : offset);
    const start = roundTime(map(t.start));
    const end = roundTime(Math.max(start + 0.3, map(t.end)));
    out.push({ ...t, start, end });
  }
  return out;
}

/** Delete a demo and its preceding gap together, or leave that space before its successor. */
export function removeDemoClip(run: Run, clipId: string, texts: TextLayer[], hold = false): Pick<Run, "demo" | "texts"> {
  const segs = timeline(run, null);
  const index = segs.findIndex((s) => s.id === clipId);
  const seg = segs[index];
  const after = segs[index + 1];
  let clips = demoClips(run).filter((c) => c.id !== clipId);
  if (!seg) return { demo: { ...run.demo, clips }, texts };
  if (hold && after) clips = clips.map((c) => c.id === after.id ? { ...c, gap: roundTime((c.gap ?? 0) + seg.gap + seg.len) } : c);
  const nextTexts = hold
    ? texts.filter((t) => !(t.start >= seg.offset - 0.001 && t.end <= seg.offset + seg.len + 0.001))
    : cutOutTexts(texts, seg.offset - seg.gap, seg.gap + seg.len);
  return { demo: { ...run.demo, clips }, texts: nextTexts };
}

/**
 * Cut a demo clip in two at file time `file`, like CapCut's split: the second half becomes its own clip right after
 * it (same file and settings), so each half is then edited on its own (founder 2026-11-03). Nothing moves on the
 * timeline, so texts stay where they are.
 */
export function splitDemoClip(run: Run, clipId: string, file: number, newId: string, partId: string): Pick<Run, "demo"> | null {
  const clips = demoClips(run);
  const own = clips.find((c) => c.id === clipId);
  const seg = timeline(run, null).find((s) => s.id === clipId);
  if (!own || !seg || !seg.editable) return null;
  const i = seg.parts.findIndex((p) => file > p.start && file < p.end);
  if (i < 0) return null;
  const p = seg.parts[i];
  const cut = roundTime(file);
  const first = storeParts([...seg.parts.slice(0, i), { ...p, end: cut }]);
  const second = storeParts([{ id: partId, start: cut, end: p.end }, ...seg.parts.slice(i + 1)]);
  const group = own.group ?? own.id;
  const rest: DemoClip = { ...own };
  delete rest.gap;
  const next: DemoClip = { ...rest, id: newId, group, ...second };
  return { demo: { ...run.demo, mode: "clips", clips: clips.flatMap((c) => (c.id === clipId ? [{ ...c, group, ...first }, next] : [c])) } };
}

/** The clips shown together with clip `id`: it and its neighbours cut from the same clip (one tile, one box). */
export function clipGroup(clips: DemoClip[], id: string): DemoClip[] {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return [];
  const g = clips[i].group;
  if (!g) return [clips[i]];
  let a = i, b = i;
  while (a > 0 && clips[a - 1].group === g) a--;
  while (b < clips.length - 1 && clips[b + 1].group === g) b++;
  return clips.slice(a, b + 1);
}

/** Reorder a clip, or extract one piece, preserving text attached to its frames. */
export function moveClipPiece(run: Run, texts: TextLayer[], segId: string, partId: string, beforeId: string | null, newId: string): Pick<Run, "hook" | "demo" | "texts"> | null {
  const before = timeline(run, null);
  const seg = before.find((s) => s.id === segId);
  const clips = demoClips(run);
  if (!seg || !seg.editable || (beforeId !== null && !clips.some((c) => c.id === beforeId))) return null;
  const partIndex = seg.parts.findIndex((p) => p.id === partId);
  if (partIndex < 0) return null;
  const part = seg.parts[partIndex];
  let hook = run.hook;
  let kept = [...clips];
  let moved: DemoClip;
  const extracted = seg.parts.length > 1;
  if (extracted) {
    const own = clips.find((c) => c.id === segId);
    moved = own
      ? { ...own, id: newId, label: `${own.label} (part)`, start: part.start, end: part.end, parts: undefined, gap: undefined, adjust: pieceAdjust(seg, partIndex) }
      : { id: newId, label: "Hook (part)", src: seg.src ?? undefined, name: "Hook", seconds: seg.seconds, start: part.start, end: part.end, adjust: pieceAdjust(seg, partIndex) };
    const rest = storeParts(seg.parts.filter((p) => p.id !== partId));
    if (segId === "hook") hook = { ...hook, ...rest };
    else kept = kept.map((c) => c.id === segId ? { ...c, ...rest } : c);
  } else {
    if (segId === "hook" || beforeId === segId) return null;
    moved = clips.find((c) => c.id === segId)!;
    kept = kept.filter((c) => c.id !== segId);
  }
  const pos = beforeId === null ? kept.length : kept.findIndex((c) => c.id === beforeId);
  kept.splice(pos, 0, moved);
  const demo = { ...run.demo, mode: "clips" as const, clips: kept };
  const after = timeline({ ...run, hook, demo }, null);
  const destination = after.find((s) => s.id === moved.id)!;
  const span = pieceSpans(seg)[partIndex];
  const pieceStart = seg.offset + span.at;
  const pieceEnd = pieceStart + span.len;
  const mapped = texts.flatMap((t) => {
    if (extracted && t.start >= pieceStart - 0.001 && t.end <= pieceEnd + 0.001) {
      const delta = destination.offset - pieceStart;
      return [{ ...t, start: roundTime(t.start + delta), end: roundTime(t.end + delta) }];
    }
    const home = before.find((s) => t.start >= s.offset - 0.001 && t.end <= s.offset + s.len + 0.001);
    if (!home) return [t];
    if (extracted && home.id === segId) {
      const target = after.find((s) => s.id === segId)!;
      return remapTexts([t], seg.offset, { parts: seg.parts, speed: segSpeed(seg) }, { parts: target.parts, speed: segSpeed(target) })
        .map((x) => ({ ...x, start: roundTime(x.start + target.offset - seg.offset), end: roundTime(x.end + target.offset - seg.offset) }));
    }
    const target = after.find((s) => s.id === home.id);
    const delta = target ? target.offset - home.offset : 0;
    return [{ ...t, start: roundTime(t.start + delta), end: roundTime(t.end + delta) }];
  });
  return { hook, demo, texts: mapped };
}

/** Shot list for "Build it clip by clip": from the hook's analysis when there is one, else a proven default
 *  for the reaction + demo format (phone filming the laptop). Suggested texts are samples until the AI writes them per product. */
export function shotList(source: Reference | null, run?: Run): Omit<DemoClip, "id">[] {
  // The script written for this product and this hook comes first; then the hook's own recipe; then a default.
  const script = run?.script;
  if (script?.shots.length && script.refId === (source?.id ?? null))
    return script.shots.map((s) => ({ label: s.label, hint: s.hint, target: s.seconds, camera: s.camera, steps: s.steps, text: s.text }));
  const fromRecipe = source?.recipe?.demo?.shots;
  if (fromRecipe?.length) return fromRecipe.map((s) => ({ label: s.label, hint: s.hint, target: s.seconds, camera: s.camera, steps: s.steps, text: s.text }));
  return [
    { label: "Show the problem", target: 2, camera: "Over your shoulder, screen fills the frame", steps: ["Open the old, messy way", "Scroll so it looks endless"], text: "doing this by hand again 😩" },
    { label: "Open your product", target: 1.5, camera: "Same angle, phone steady", steps: ["Open your site or app", "Let it fully load"], text: "then I found this" },
    { label: "The magic moment", target: 3, camera: "Closer, button in frame", steps: ["Click the main button", "Film until the result shows"], text: "one click..." },
    { label: "The result", target: 2, camera: "Slow push in", steps: ["Scroll the finished result", "End on the best part"], text: "how is this free 😭" },
  ];
}

/** The six steps of a video, done or not, in order (the run page and the videos grid both use this). */
export function runSteps(run: Run): boolean[] {
  const h = run.hook;
  const hasDemo = demoClips(run).some((c) => clipSrc(c));
  const hasSound = run.sounds ? run.sounds.length > 0 : Boolean(run.sound);
  return [Boolean(run.product?.brief), Boolean(run.sourceRefId) || Boolean(h.source === "describe" && h.describeReady && h.describe?.trim()), Boolean(h.face), Boolean(h.generated), hasDemo, hasSound];
}
