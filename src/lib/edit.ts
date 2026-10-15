import type { Adjust } from "@/lib/adjust";
import { speedOf } from "@/lib/adjust";
const roundTime = (n: number) => Math.round(n * 1000) / 1000;
import type { DemoClip, Reference, Run, TextLayer } from "@/lib/types";

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
  /** Timeline position and on-screen length. */
  offset: number;
  len: number;
};

/** Demo clips of a run; older runs with a single demo clip read as one clip. */
export function demoClips(run: Run): DemoClip[] {
  if (run.demo.clips) return run.demo.clips;
  const c = run.demo.clip;
  if (c?.mediaId && c.kind === "video") return [{ id: "demo", label: "Your demo", mediaId: c.mediaId, name: c.name, seconds: c.length ?? 3, start: 0, end: c.length ?? 3 }];
  return [];
}

export const segLen = (s: { start: number; end: number; adjust?: Partial<Adjust> }) => Math.max(0.1, s.end - s.start) / speedOf(s.adjust);

/** The run's timeline. With no demo clip yet, a 3s "Your demo" placeholder follows the hook. */
export function timeline(run: Run, source: Reference | null): Seg[] {
  const h = run.hook;
  const hookSrc = h.generated?.src ?? (h.clip?.mediaId ? `/api/media/${h.clip.mediaId}` : source?.mediaId ? `/api/media/${source.mediaId}` : null);
  const segs: Omit<Seg, "offset" | "len">[] = [
    h.generated
      ? { id: "hook", label: "Hook", src: hookSrc, seconds: h.generated.seconds, start: h.start ?? 0, end: h.end ?? h.generated.seconds, adjust: h.adjust, editable: true }
      : { id: "hook", label: "Hook", src: hookSrc, seconds: h.end ?? 3, start: h.clip ? 0 : (h.start ?? 0), end: h.clip ? Math.max(0.5, (h.end ?? 3) - (h.start ?? 0)) : (h.end ?? 3), editable: false },
  ];
  const clips = demoClips(run).filter((c) => c.mediaId);
  clips.forEach((c, i) => {
    const seconds = c.seconds ?? 3;
    segs.push({ id: c.id, label: clips.length > 1 ? `${i + 1}. ${c.label}` : c.label, src: `/api/media/${c.mediaId}`, seconds, start: c.start ?? 0, end: c.end ?? seconds, adjust: c.adjust, editable: true });
  });
  if (!clips.length) segs.push({ id: "placeholder", label: "Demo", src: null, seconds: 3, start: 0, end: 3, editable: false });
  let at = 0;
  return segs.map((s) => {
    const len = s.editable ? segLen(s) : Math.max(0.5, s.end - s.start);
    const seg = { ...s, offset: at, len };
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
  const hasDemo = demoClips(run).some((c) => c.mediaId);
  const hasSound = run.sounds ? run.sounds.length > 0 : Boolean(run.sound);
  return [Boolean(run.sourceRefId) || Boolean(h.source === "describe" && h.describeReady && h.describe?.trim()), Boolean(h.face), Boolean(h.generated), hasDemo, hasSound];
}
