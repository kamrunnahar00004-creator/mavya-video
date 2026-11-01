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
  { key: "warmth", label: "Temp", min: -50, max: 50, step: 1 },
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

/*
 * Contrast and Temp are measured from CapCut desktop screenshots of one photo (2026-11-01), so a slider value looks
 * like the same value there. render/render.mjs repeats these numbers for the export: change both together.
 */

/** Red, green, blue gains at Temp 50 and -50. CapCut scales each channel by a fixed amount. */
const TEMP_HOT = [1.7, 0.82, 0.21];
const TEMP_COLD = [0.81, 1.01, 1.52];
export const tempGains = (w: number): [number, number, number] => {
  const a = Math.abs(w) / 50;
  const [r, g, b] = (w < 0 ? TEMP_COLD : TEMP_HOT).map((x) => 1 + (x - 1) * a);
  return [r, g, b];
};

/** SVG filter id for a Temp value (the matching <filter> is rendered by <WarmthFilter>). */
export const warmthId = (w: number) => `mavya-warm-${w < 0 ? "m" : ""}${Math.abs(w)}`;

/** Color matrix values for an feColorMatrix (Temp only). */
export function warmthMatrix(w: number) {
  const [r, g, b] = tempGains(w);
  return `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`;
}

/** Contrast is an S-curve around this level (0..1): darks fall and lights rise, rolling off softly at both ends. */
export const CONTRAST_PIVOT = 0.44;
/** Slider value to curve strength, measured at 10, 20, 35 and 50. */
const CONTRAST_POINTS = [[0, 1], [10, 1.22], [20, 1.46], [35, 1.94], [50, 3.1]];

/** Curve strength for a contrast value. Negative values are the same curve undone (1 / strength). */
export function contrastGamma(v: number) {
  const a = Math.min(50, Math.abs(v));
  const i = Math.max(0, CONTRAST_POINTS.findIndex(([x]) => x >= a) - 1);
  const [x0, y0] = CONTRAST_POINTS[i];
  const [x1, y1] = CONTRAST_POINTS[i + 1];
  const g = y0 + ((a - x0) / (x1 - x0)) * (y1 - y0);
  return v < 0 ? 1 / g : g;
}

/** One channel value (0..1) through the contrast curve. */
export function contrastCurve(x: number, v: number) {
  const p = CONTRAST_PIVOT;
  const g = contrastGamma(v);
  return x < p ? p * Math.pow(x / p, g) : 1 - (1 - p) * Math.pow((1 - x) / (1 - p), g);
}

export const contrastId = (v: number) => `mavya-contrast-${v < 0 ? "m" : ""}${Math.abs(v)}`;

/** The curve as tableValues for an feFuncR/G/B. */
export const contrastTable = (v: number) => Array.from({ length: 65 }, (_, i) => contrastCurve(i / 64, v).toFixed(4)).join(" ");

/** How far (in % of the frame) the zoomed picture can move from center on one axis. */
const panRoom = (scale: number) => ((scale - 1) / (2 * scale)) * 100;

/** CSS for a <video> at file time t: filter + zoom / position / flip transform. */
export function videoStyle(a?: Partial<Adjust> | null, t?: number): CSSProperties | undefined {
  if (!isAdjusted(a)) return undefined;
  const v = { ...fullAdjust(a), ...motionAt(a, t) };
  const parts = [];
  if (v.brightness) parts.push(`brightness(${1 + v.brightness / 100})`);
  if (v.contrast) parts.push(`url(#${contrastId(v.contrast)})`);
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
  if (v.brightness) out.push(`colorchannelmixer=rr=${b}:gg=${b}:bb=${b}`);
  if (v.contrast) {
    const g = contrastGamma(v.contrast);
    const p = CONTRAST_PIVOT * 255;
    const curve = `'if(lt(val,${p}),${p}*pow(val/${p},${g}),255-${255 - p}*pow(max(255-val,0)/${255 - p},${g}))'`;
    out.push(`lutrgb=r=${curve}:g=${curve}:b=${curve}`);
  }
  if (v.saturation) out.push(`eq=saturation=${1 + v.saturation / 50}`);
  if (v.warmth) {
    const [r, g, bl] = tempGains(v.warmth);
    out.push(`colorchannelmixer=rr=${r}:gg=${g}:bb=${bl}`);
  }
  return out;
}
