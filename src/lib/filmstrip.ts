/** Bounded frame cache with four decoders at most and eight retained file players. */
const cache = new Map<string, Promise<string | null>>();
const queues = new Map<string, Promise<unknown>>();
const players = new Map<string, { video: HTMLVideoElement; busy: boolean }>();
const failed = new Map<string, number>();
let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try { return await work(); }
  finally { const next = waiting.shift(); if (next) next(); else active--; }
}

function release(src: string) {
  const entry = players.get(src);
  if (!entry) return;
  entry.video.pause();
  entry.video.removeAttribute("src");
  entry.video.load();
  players.delete(src);
}

function grab(src: string, t: number): Promise<string | null> {
  if ((failed.get(src) ?? 0) > Date.now()) return Promise.resolve(null);
  let entry = players.get(src);
  if (!entry) {
    const video = document.createElement("video");
    // Files come from storage on another origin; reading pixels needs a CORS request.
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    entry = { video, busy: false };
    players.set(src, entry);
    video.src = src;
  }
  const current = entry;
  const video = current.video;
  current.busy = true;
  return new Promise((resolve) => {
    let done = false;
    const finish = (url: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", seek);
      video.removeEventListener("loadeddata", draw);
      video.removeEventListener("seeked", draw);
      video.removeEventListener("error", error);
      current.busy = false;
      if (!url) {
        failed.set(src, Date.now() + 30000);
        if (failed.size > 32) failed.delete(failed.keys().next().value!);
        release(src);
      }
      for (const [key, player] of players) {
        if (players.size <= 8) break;
        if (!player.busy) release(key);
      }
      resolve(url);
    };
    const timer = setTimeout(() => finish(null), 8000);
    const error = () => finish(null);
    const draw = () => {
      if (video.seeking || video.readyState < 2) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64; canvas.height = 114;
        const ctx = canvas.getContext("2d");
        if (!ctx || !video.videoWidth || !video.videoHeight) return finish(null);
        const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
        const w = canvas.width / scale, h = canvas.height / scale;
        ctx.drawImage(video, (video.videoWidth - w) / 2, (video.videoHeight - h) / 2, w, h, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.6));
      } catch { finish(null); }
    };
    const seek = () => {
      const target = Math.max(0, Math.min(t, (video.duration || t + 0.1) - 0.05));
      video.addEventListener("seeked", draw);
      video.addEventListener("loadeddata", draw);
      if (Math.abs(video.currentTime - target) < 0.001) draw();
      else video.currentTime = target;
    };
    video.addEventListener("error", error);
    if (video.error) error();
    else if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek);
  });
}

export function frameAt(src: string, t: number): Promise<string | null> {
  const key = `${src}@${Math.round(t * 1000) / 1000}`;
  const found = cache.get(key);
  if (found) return found;
  const pending = (queues.get(src) ?? Promise.resolve()).then(() => slot(() => grab(src, t)));
  queues.set(src, pending);
  cache.set(key, pending);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  void pending.then((url) => {
    if (!url && cache.get(key) === pending) cache.delete(key);
    if (queues.get(src) === pending) queues.delete(src);
  });
  return pending;
}
