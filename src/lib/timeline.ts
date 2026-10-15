import { AVATAR_TONES, runTexts, uid } from "@/lib/client";
import type { Reference, Run, TItem, TKey, Timeline, VClip, VKey } from "@/lib/types";

export const clipLen = (c: VClip) => Math.max(0.1, (c.out - c.in) / c.speed);

export function clipStarts(clips: VClip[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const c of clips) {
    out.push(acc);
    acc += clipLen(c);
  }
  return out;
}

export function timelineEnd(tl: Timeline): number {
  const video = tl.clips.reduce((a, c) => a + clipLen(c), 0);
  const text = tl.texts.reduce((a, x) => Math.max(a, x.end), 0);
  const audio = tl.audio.reduce((a, x) => Math.max(a, x.start + (x.out - x.in)), 0);
  return Math.max(video, text, audio, 1);
}

export function newVClip(p: Partial<VClip> & Pick<VClip, "kind" | "name">): VClip {
  return { id: uid(), mediaId: null, in: 0, out: 3, srcLength: null, speed: 1, scale: 100, x: 0, y: 0, rotate: 0, volume: 100, ...p };
}

function lerp(a: number, b: number, f: number) {
  return a + (b - a) * f;
}

/** Linear interpolation between keyframes; with none, the static values apply. */
export function sampleKeys<K extends { t: number }>(keys: K[] | undefined, t: number, fields: (keyof K)[], base: K): K {
  if (!keys?.length) return base;
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0];
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return last;
  const i = sorted.findIndex((k) => k.t > t);
  const a = sorted[i - 1];
  const b = sorted[i];
  const f = (t - a.t) / Math.max(0.0001, b.t - a.t);
  const out = { ...a, t };
  for (const k of fields) (out[k] as number) = lerp(a[k] as number, b[k] as number, f);
  return out;
}

export const sampleClip = (c: VClip, local: number): VKey => sampleKeys(c.keys, local, ["scale", "x", "y", "rotate"], { t: local, scale: c.scale, x: c.x, y: c.y, rotate: c.rotate });
export const sampleText = (x: TItem, local: number): TKey => sampleKeys(x.keys, local, ["x", "y", "size"], { t: local, x: x.x, y: x.y, size: x.size });

/** Builds the editor timeline for a run: hook clip, demo clip, hook text. */
export function buildTimeline(run: Run, ref: Reference | null): Timeline {
  const clips: VClip[] = [];
  const start = run.hook.start ?? 0;
  const end = run.hook.end ?? 3;
  const hookLen = Math.max(0.5, end - start);
  const h = run.hook.clip;
  if (h && h.kind === "placeholder") {
    clips.push(newVClip({ kind: "placeholder", name: h.name, tones: h.tones ?? AVATAR_TONES[0], in: 0, out: hookLen }));
  } else if (h) {
    clips.push(newVClip({ kind: h.kind, mediaId: h.mediaId, name: h.name, in: 0, out: h.length ? Math.min(h.length, hookLen) : hookLen, srcLength: h.length }));
  } else if (ref && run.hook.face) {
    clips.push(newVClip({ kind: "video", mediaId: ref.mediaId, name: "Hook (face swap preview)", in: start, out: end, srcLength: ref.analysis?.duration ?? null }));
  }
  const d = run.demo.clip;
  if (d) {
    const len = d.length ?? 5;
    clips.push(newVClip({ kind: d.kind, mediaId: d.mediaId, name: d.name, in: 0, out: d.kind === "video" ? Math.min(len, 10) : 5, srcLength: d.kind === "video" ? d.length : null, frame: run.demo.frame === "laptop" ? "laptop" : undefined }));
  }
  const texts: TItem[] = runTexts(run).map((x, i) => ({ ...x, id: uid(), row: i }));
  return { v: 2, productName: "", refId: ref?.id ?? null, refMediaId: ref?.mediaId ?? null, refTitle: ref?.title ?? "", clips, texts, audio: [] };
}

export function isTimeline(p: unknown): p is Timeline {
  return Boolean(p && typeof p === "object" && (p as Timeline).v === 2);
}
