import type { CSSProperties } from "react";

/** Look adjustments for the generated hook clip (step 3, Advanced settings). */
export type Adjust = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  /** 0..100 = 100%..200% */
  zoom: number;
  /** Where the zoomed frame sits: -100..100 of the room zoom leaves on each axis (0 = center). */
  panX: number;
  panY: number;
  /** Playback speed, 0.5..2 (1 = normal). Changes the clip's length on the timeline. */
  speed: number;
  /** Mirror left/right. */
  flip: boolean;
  /** The clip's own sound, 0..100 (100 = as recorded). Mixed under the music like CapCut. */
  volume: number;
  /** Zoom / position keyframes. Times are seconds in the generated file, so they stay on the same moment after Cut or Speed. */
  keys: MotionKey[];
};

export type Motion = { zoom: number; panX: number; panY: number };
export type MotionKey = Motion & { t: number };

export type AdjustRow = { key: "brightness" | "contrast" | "saturation" | "warmth" | "zoom" | "speed" | "volume"; label: string; min: number; max: number; step: number };

export const ADJUST_ROWS: AdjustRow[] = [
  { key: "volume", label: "Volume", min: 0, max: 100, step: 1 },
  { key: "speed", label: "Speed", min: 0.5, max: 2, step: 0.05 },
  { key: "brightness", label: "Brightness", min: -50, max: 50, step: 1 },
  { key: "contrast", label: "Contrast", min: -50, max: 50, step: 1 },
  { key: "saturation", label: "Saturation", min: -50, max: 50, step: 1 },
  { key: "warmth", label: "Warmth", min: -50, max: 50, step: 1 },
  { key: "zoom", label: "Zoom", min: 0, max: 100, step: 1 },
];

export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, zoom: 0, panX: 0, panY: 0, speed: 1, flip: false, volume: 100, keys: [] };

export const fullAdjust = (a?: Partial<Adjust> | null): Adjust => ({ ...NO_ADJUST, ...a });

export const isAdjusted = (a?: Partial<Adjust> | null) => {
  const v = fullAdjust(a);
  return v.keys.length > 0 || (Object.keys(NO_ADJUST) as (keyof Adjust)[]).some((k) => k !== "keys" && v[k] !== NO_ADJUST[k]);
};

/** Playback speed of the hook clip (1 unless set). */
export const speedOf = (a?: Partial<Adjust> | null) => Math.max(0.5, Math.min(2, a?.speed ?? 1));

const sortKeys = (keys: MotionKey[]) => [...keys].sort((a, b) => a.t - b.t);
const pick = (k: Motion): Motion => ({ zoom: k.zoom, panX: k.panX, panY: k.panY });

/** Zoom and position at file time t: the static values, or eased between keyframes. */
export function motionAt(a: Partial<Adjust> | null | undefined, t?: number): Motion {
  const v = fullAdjust(a);
  const ks = sortKeys(v.keys);
  if (!ks.length || t === undefined) return pick(v);
  if (t <= ks[0].t) return pick(ks[0]);
  const last = ks[ks.length - 1];
  if (t >= last.t) return pick(last);
  const i = ks.findIndex((k, j) => k.t <= t && t < ks[j + 1].t);
  const [from, to] = [ks[i], ks[i + 1]];
  const p = (t - from.t) / (to.t - from.t);
  const e = p * p * (3 - 2 * p); // ease in-out
  const mix = (x: number, y: number) => Math.round((x + (y - x) * e) * 10) / 10;
  return { zoom: mix(from.zoom, to.zoom), panX: mix(from.panX, to.panX), panY: mix(from.panY, to.panY) };
}

/** Index of the keyframe at file time t (within a frame or two), or -1. */
export const keyAt = (a: Partial<Adjust> | null | undefined, t: number) => sortKeys(fullAdjust(a).keys).findIndex((k) => Math.abs(k.t - t) < 0.06);

/** Change zoom / position at file time t. With keyframes, this adds or updates the keyframe there (like CapCut). */
export function setMotion(a: Partial<Adjust> | null | undefined, t: number, patch: Partial<Motion>): Adjust {
  const v = fullAdjust(a);
  if (!v.keys.length) return { ...v, ...patch };
  const ks = sortKeys(v.keys);
  const i = keyAt(v, t);
  const next: MotionKey = { ...motionAt(v, t), ...patch, t: i >= 0 ? ks[i].t : Math.round(t * 100) / 100 };
  return { ...v, keys: sortKeys(i >= 0 ? ks.map((k, j) => (j === i ? next : k)) : [...ks, next]) };
}

/** The diamond button: add a keyframe at t, or remove the one there. Removing the last one keeps its look as the static value. */
export function toggleKey(a: Partial<Adjust> | null | undefined, t: number): Adjust {
  const v = fullAdjust(a);
  const ks = sortKeys(v.keys);
  const i = keyAt(v, t);
  if (i < 0) return { ...v, keys: sortKeys([...ks, { ...motionAt(v, t), t: Math.round(t * 100) / 100 }]) };
  const rest = ks.filter((_, j) => j !== i);
  return rest.length ? { ...v, keys: rest } : { ...v, ...pick(ks[i]), keys: [] };
}

/** Move keyframe i (in time order) to file time t. */
export function moveKey(a: Partial<Adjust> | null | undefined, i: number, t: number): Adjust {
  const v = fullAdjust(a);
  return { ...v, keys: sortKeys(sortKeys(v.keys).map((k, j) => (j === i ? { ...k, t: Math.round(t * 100) / 100 } : k))) };
}

/** Red/blue gain for warmth (-50..50); shared by the preview and the export so both match. */
const warmGain = (w: number) => (w / 50) * 0.12;

/** SVG filter id for a warmth value (the matching <filter> is rendered by <WarmthFilter>). */
export const warmthId = (w: number) => `mavya-warm-${w < 0 ? "m" : ""}${Math.abs(w)}`;

/** Color matrix values for an feColorMatrix (warmth only). */
export function warmthMatrix(w: number) {
  const k = warmGain(w);
  return `${1 + k} 0 0 0 0  0 ${1 + k * 0.25} 0 0 0  0 0 ${1 - k} 0 0  0 0 0 1 0`;
}

/** How far (in % of the frame) the zoomed picture can move from center on one axis. */
const panRoom = (scale: number) => ((scale - 1) / (2 * scale)) * 100;

/** CSS for a <video> at file time t: filter + zoom / position / flip transform. */
export function videoStyle(a?: Partial<Adjust> | null, t?: number): CSSProperties | undefined {
  if (!isAdjusted(a)) return undefined;
  const v = { ...fullAdjust(a), ...motionAt(a, t) };
  const parts = [];
  if (v.brightness) parts.push(`brightness(${1 + v.brightness / 100})`);
  if (v.contrast) parts.push(`contrast(${1 + v.contrast / 100})`);
  if (v.saturation) parts.push(`saturate(${1 + v.saturation / 50})`);
  if (v.warmth) parts.push(`url(#${warmthId(v.warmth)})`);
  const s = 1 + v.zoom / 100;
  const room = panRoom(s);
  const move = v.zoom ? [`scale(${s})`, `translate(${(v.panX / 100) * room}%, ${(v.panY / 100) * room}%)`] : [];
  if (v.flip) move.push("scaleX(-1)");
  return {
    filter: parts.length ? parts.join(" ") : undefined,
    transform: move.length ? move.join(" ") : undefined,
  };
}

/** Pan change for a drag of (dx, dy) pixels on a frame of w x h; keeps values in -100..100. */
export function panBy(zoom: number, dx: number, dy: number, w: number, h: number, from: { panX: number; panY: number }) {
  const s = 1 + zoom / 100;
  const reach = (s - 1) / 2; // visual px of travel per px of frame, from center to edge
  const clamp = (n: number) => Math.round(Math.max(-100, Math.min(100, n)));
  if (!reach) return { panX: 0, panY: 0 };
  return { panX: clamp(from.panX + (dx / (reach * w)) * 100), panY: clamp(from.panY + (dy / (reach * h)) * 100) };
}

/** The same look as an ffmpeg -vf chain, for the export (9:16 frame of size w x h). */
export function ffmpegAdjust(a: Partial<Adjust> | null | undefined, w: number, h: number): string[] {
  const v = fullAdjust(a);
  const out: string[] = [];
  if (v.speed !== 1) out.push(`setpts=PTS/${v.speed}`);
  if (v.flip) out.push("hflip");
  // Static helper; the hosted renderer applies keyframes with zoompan in render/render.mjs.
  if (v.zoom) {
    const s = 1 + v.zoom / 100;
    // Picture moves with pan, so the crop window moves the other way.
    out.push(`scale=iw*${s}:ih*${s}`, `crop=${w}:${h}:(iw-${w})/2*(1-${v.panX / 100}):(ih-${h})/2*(1-${v.panY / 100})`);
  }
  const b = 1 + v.brightness / 100;
  const k = warmGain(v.warmth);
  if (v.brightness) out.push(`colorchannelmixer=rr=${b}:gg=${b}:bb=${b}`);
  if (v.contrast || v.saturation) out.push(`eq=contrast=${1 + v.contrast / 100}:saturation=${1 + v.saturation / 50}`);
  if (v.warmth) out.push(`colorchannelmixer=rr=${1 + k}:gg=${1 + k * 0.25}:bb=${1 - k}`);
  return out;
}
