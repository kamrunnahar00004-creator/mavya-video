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
  { key: "brightness", label: "Exposure", min: -50, max: 50, step: 1 },
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

/** Zoom and position at file time t: the static values, or eased between keyframes. `exact` keeps the fractions (for
 * drawing); without it values round to 0.1 for the controls. */
export function motionAt(a: Partial<Adjust> | null | undefined, t?: number, exact = false): Motion {
  const v = fullAdjust(a);
  const ks = sortKeys(v.keys);
  if (!ks.length || t === undefined) return pick(v);
  // The same rule as both exports (render.mjs curve, browser-export curveAt): before the first key, the first key; from
  // a key's time on, the segment after it, so two keys sharing a time show the later one (Codex 2026-11-23).
  if (t < ks[0].t) return pick(ks[0]);
  const last = ks[ks.length - 1];
  if (t >= last.t) return pick(last);
  const i = ks.findIndex((k, j) => k.t <= t && t < ks[j + 1].t);
  const [from, to] = [ks[i], ks[i + 1]];
  const p = (t - from.t) / (to.t - from.t);
  const e = p * p * (3 - 2 * p); // ease in-out
  const lerp = (x: number, y: number) => x + (y - x) * e;
  // Like CapCut (founder 2026-11-23): the zoom and the picture's real place on screen move together. The place on
  // screen is pan x zoom (pan is a share of the room the zoom leaves), so that product is what is blended; blending
  // pan and zoom apart made a zoom in from 0 hug the center, then rush to the side at the end.
  const zoom = lerp(from.zoom, to.zoom);
  const pan = (a: number, b: number) => (zoom > 1e-9 ? Math.max(-100, Math.min(100, lerp(a * from.zoom, b * to.zoom) / zoom)) : lerp(a, b));
  // Drawing uses the exact value: rounding to 0.1 made a slow zoom move in uneven steps (founder 2026-11-11).
  const out = (x: number) => (exact ? x : Math.round(x * 10) / 10);
  return { zoom: out(zoom), panX: out(pan(from.panX, to.panX)), panY: out(pan(from.panY, to.panY)) };
}

/** Index of the keyframe at file time t (within a frame or two), or -1. */
export const keyAt = (a: Partial<Adjust> | null | undefined, t: number) => sortKeys(fullAdjust(a).keys).findIndex((k) => Math.abs(k.t - t) < 0.06);

/** Change zoom / position at file time t. With keyframes, this adds or updates the keyframe there (like CapCut). */
export function setMotion(a: Partial<Adjust> | null | undefined, t: number, patch: Partial<Motion>): Adjust {
  const v = fullAdjust(a);
  if (!v.keys.length) return { ...v, ...patch };
  const ks = sortKeys(v.keys);
  const i = keyAt(v, t);
  // An existing keyframe changes only what the patch says, from its own values: the blended value at the playhead
  // (a frame or two off) would carry the next key's place into it (Codex 2026-11-23). A new key starts exactly where
  // the picture is, so adding it does not move anything.
  const next: MotionKey = i >= 0 ? { ...ks[i], ...patch } : { ...motionAt(v, t, true), ...patch, t: Math.round(t * 100) / 100 };
  return { ...v, keys: sortKeys(i >= 0 ? ks.map((k, j) => (j === i ? next : k)) : [...ks, next]) };
}

/** The diamond button: add a keyframe at t, or remove the one there. Removing the last one keeps its look as the static value. */
export function toggleKey(a: Partial<Adjust> | null | undefined, t: number): Adjust {
  const v = fullAdjust(a);
  const ks = sortKeys(v.keys);
  const i = keyAt(v, t);
  if (i < 0) return { ...v, keys: sortKeys([...ks, { ...motionAt(v, t, true), t: Math.round(t * 100) / 100 }]) };
  const rest = ks.filter((_, j) => j !== i);
  return rest.length ? { ...v, keys: rest } : { ...v, ...pick(ks[i]), keys: [] };
}

/** Move keyframe i (in time order) to file time t. */
export function moveKey(a: Partial<Adjust> | null | undefined, i: number, t: number): Adjust {
  const v = fullAdjust(a);
  const ks = sortKeys(v.keys);
  // Never onto another key's time (two keys at one moment have no in-between; Codex 2026-11-23): stays where it was.
  const at = Math.round(t * 100) / 100;
  if (ks.some((k, j) => j !== i && Math.abs(k.t - at) < 0.005)) return v;
  return { ...v, keys: sortKeys(ks.map((k, j) => (j === i ? { ...k, t: at } : k))) };
}

/*
 * Exposure, Contrast and Temp are measured from CapCut desktop screenshots of one photo (2026-11-01), so a slider value looks
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

/** Straight-line lookup in a measured [slider, value] table. */
function measured(points: number[][], v: number) {
  const a = Math.max(points[0][0], Math.min(points[points.length - 1][0], v));
  const i = Math.max(0, points.findIndex(([x]) => x >= a) - 1);
  const [x0, y0] = points[i];
  const [x1, y1] = points[i + 1];
  return y0 + ((a - x0) / (x1 - x0)) * (y1 - y0);
}

/** Exposure lifts or lowers a channel as 1 - (1 - x)^k: whites stay white, and the top rolls off softly. */
const EXPOSURE_POINTS = [[-50, 0.28], [-25, 0.44], [0, 1], [20, 1.57], [40, 2.33], [50, 2.95]];
export const exposurePower = (v: number) => measured(EXPOSURE_POINTS, v);

/** One channel value (0..1) through the exposure curve. */
export const exposureCurve = (x: number, v: number) => 1 - Math.pow(1 - x, exposurePower(v));

export const exposureId = (v: number) => `mavya-exposure-${v < 0 ? "m" : ""}${Math.abs(v)}`;

/** The curve as tableValues for an feFuncR/G/B. Low Exposure is steep near white, so it takes a fine table. */
export const exposureTable = (v: number) => Array.from({ length: 257 }, (_, i) => exposureCurve(i / 256, v).toFixed(4)).join(" ");

/** Above 0, contrast is an S-curve around this level (0..1): darks fall and lights rise, rolling off softly at both ends. */
export const CONTRAST_PIVOT = 0.44;
/** Below 0, contrast is a straight line through this level (0..1) that flattens the picture. */
export const CONTRAST_FLAT_PIVOT = 111.5 / 255;
/** Slider value to curve strength, measured at 10, 20, 35 and 50. */
const CONTRAST_POINTS = [[0, 1], [10, 1.22], [20, 1.46], [35, 1.94], [50, 3.1]];

/** Curve strength for a positive contrast value. */
export const contrastGamma = (v: number) => measured(CONTRAST_POINTS, v);

/** Line slope for a negative contrast value. */
export const contrastSlope = (v: number) => 1 + Math.max(-50, v) / 125;

/** One channel value (0..1) through the contrast curve. */
export function contrastCurve(x: number, v: number) {
  if (v < 0) return CONTRAST_FLAT_PIVOT + (x - CONTRAST_FLAT_PIVOT) * contrastSlope(v);
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
  const v = { ...fullAdjust(a), ...motionAt(a, t, true) };
  const parts = [];
  if (v.brightness) parts.push(`url(#${exposureId(v.brightness)})`);
  if (v.contrast) parts.push(`url(#${contrastId(v.contrast)})`);
  if (v.saturation) parts.push(`saturate(${1 + v.saturation / 50})`);
  if (v.warmth) parts.push(`url(#${warmthId(v.warmth)})`);
  const s = 1 + v.zoom / 100;
  const room = panRoom(s);
  // rotate(0.02deg) (0.09 px of tilt across the preview, invisible) keeps Chrome from snapping the zoomed video to
  // whole screen pixels: without it a keyframed zoom wobbled 0.5 px every frame in the small preview, ~2 px of the
  // video (founder 2026-11-11: "in the preview there is the wobble"; measured 0.54 px, with it 0.13, perfect 0.06).
  // The tilt would bare a hair of edge in a corner when the picture is pushed fully to one side (Codex 2026-11-23);
  // 0.2 % more scale covers it at any zoom (the tilt needs 0.13 %; 1.4 px on a 720 px frame, invisible; the exports
  // have no tilt and need none).
  const move = v.zoom ? [`scale(${s * 1.002})`, `translate(${(v.panX / 100) * room}%, ${(v.panY / 100) * room}%)`, "rotate(0.02deg)"] : [];
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
  if (v.brightness) {
    const curve = `'255-255*pow(max(255-val,0)/255,${exposurePower(v.brightness)})'`;
    out.push(`lutrgb=r=${curve}:g=${curve}:b=${curve}`);
  }
  if (v.contrast) {
    const g = contrastGamma(v.contrast);
    const p = CONTRAST_PIVOT * 255;
    const f = CONTRAST_FLAT_PIVOT * 255;
    const curve = v.contrast < 0
      ? `'${f}+(val-${f})*${contrastSlope(v.contrast)}'`
      : `'if(lt(val,${p}),${p}*pow(val/${p},${g}),255-${255 - p}*pow(max(255-val,0)/${255 - p},${g}))'`;
    out.push(`lutrgb=r=${curve}:g=${curve}:b=${curve}`);
  }
  if (v.saturation) out.push(`eq=saturation=${1 + v.saturation / 50}`);
  if (v.warmth) {
    const [r, g, bl] = tempGains(v.warmth);
    out.push(`colorchannelmixer=rr=${r}:gg=${g}:bb=${bl}`);
  }
  return out;
}
