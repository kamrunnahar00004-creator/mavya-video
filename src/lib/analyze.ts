import type { Analysis, Role, Segment } from "@/lib/types";

/** The hook is the first 3 seconds, or up to the first cut if one lands just after. */
export const HOOK_SECONDS = 3;

function waitFor(video: HTMLVideoElement, event: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("Could not read this video"));
    };
    const cleanup = () => {
      video.removeEventListener(event, ok);
      video.removeEventListener("error", fail);
    };
    video.addEventListener(event, ok, { once: true });
    video.addEventListener("error", fail, { once: true });
  });
}

async function seek(video: HTMLVideoElement, t: number) {
  const done = waitFor(video, "seeked");
  video.currentTime = t;
  await done;
}

/**
 * Runs in the browser: samples frames, scores how much each frame differs from
 * the previous one, and treats sharp jumps as scene cuts. Then splits the video
 * into hook (first 3s), demo parts, and a CTA when the last short part sits at
 * the end.
 */
export async function analyzeVideo(src: string, onProgress?: (p: number) => void): Promise<Analysis> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  video.src = src;
  await waitFor(video, "loadedmetadata");

  // Some recorded WebM files report an unknown duration until you seek to the end.
  if (!Number.isFinite(video.duration)) {
    await seek(video, 1e7);
    await seek(video, 0);
  }
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read the video length");
  const width = video.videoWidth;
  const height = video.videoHeight;
  const w = 48;
  const h = Math.max(1, Math.round((w * height) / Math.max(1, width)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");

  const step = Math.max(0.2, duration / 300);
  const times: number[] = [];
  for (let t = 0; t < duration; t += step) times.push(t);

  const diffs: { t: number; d: number }[] = [];
  let prev: Uint8ClampedArray | null = null;
  for (let i = 0; i < times.length; i++) {
    await seek(video, times[i]);
    ctx.drawImage(video, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    if (prev) {
      // Full-color difference: brightness alone misses cuts between equally bright scenes.
      let sum = 0;
      for (let p = 0; p < data.length; p += 4) {
        sum += Math.abs(data[p] - prev[p]) + Math.abs(data[p + 1] - prev[p + 1]) + Math.abs(data[p + 2] - prev[p + 2]);
      }
      diffs.push({ t: times[i], d: sum / (3 * (data.length / 4)) });
    }
    prev = data;
    onProgress?.((i + 1) / (times.length + 6));
  }

  const sorted = diffs.map((x) => x.d).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const threshold = Math.max(18, median * 4);
  const cuts: number[] = [];
  for (const { t, d } of diffs) {
    if (d >= threshold && (cuts.length === 0 || t - cuts[cuts.length - 1] >= 0.6) && t > 0.3 && t < duration - 0.3) {
      cuts.push(Math.round(t * 10) / 10);
    }
  }

  const segments = buildSegments(duration, cuts);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    await seek(video, Math.min(duration - 0.05, (s.start + s.end) / 2));
    const tw = 120;
    const th = Math.round((tw * height) / Math.max(1, width));
    const tc = document.createElement("canvas");
    tc.width = tw;
    tc.height = th;
    tc.getContext("2d")?.drawImage(video, 0, 0, tw, th);
    s.thumb = tc.toDataURL("image/jpeg", 0.7);
    onProgress?.(Math.min(1, (times.length + i + 1) / (times.length + segments.length)));
  }

  video.removeAttribute("src");
  video.load();
  return { duration, width, height, cuts, segments, analyzedAt: new Date().toISOString() };
}

export function buildSegments(duration: number, cuts: number[]): Segment[] {
  const firstCut = cuts[0];
  const hookEnd = Math.min(duration, firstCut !== undefined && firstCut > HOOK_SECONDS && firstCut <= HOOK_SECONDS + 0.8 ? firstCut : HOOK_SECONDS);
  const bounds = [0, hookEnd, ...cuts.filter((c) => c > hookEnd + 0.3), duration].filter((v, i, a) => i === 0 || v - a[i - 1] > 0.05);

  const segments: Segment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    let role: Role = i === 0 ? "hook" : "body";
    const start = bounds[i];
    const end = bounds[i + 1];
    if (i > 0 && i === bounds.length - 2 && end - start <= 4 && start >= duration * 0.65) role = "cta";
    segments.push({ start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10, role, note: "" });
  }
  return segments;
}
