// Uploads a finished export to its storage link (founder 2026-11-15: an export "stuck" because one upload connection
// hung and each try was allowed the whole 13 minutes). Each try watches its own progress: silence past 45 s while
// connecting, 20 s while sending or 60 s while waiting for the answer ends that try and the next starts at once;
// every try also stops at the deadline or when its signal is aborted (an export's upload has none: uploadWhileAlive).

import { ALIVE_PING_MS } from "@/lib/export-alive";

/** The parts of XMLHttpRequest used here (fetch reports no upload progress, so a hang can't be told from slow). */
export type XhrLike = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  abort(): void;
  status: number;
  upload: { onprogress: ((e: { loaded: number; total: number }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
};

export type PutOptions = {
  contentType: string;
  /** No later than this (ms since epoch) for any try. */
  deadline: number;
  /** How many tries at most. */
  tries?: number;
  /** A try with no bytes sent for this long is abandoned (it hung) and the next one starts. */
  stallMs?: number;
  /** Longer allowances (Codex 2026-11-15): before the first bytes move (connecting, CORS check) and once every byte
   *  is sent (waiting for storage to answer). */
  connectMs?: number;
  answerMs?: number;
  /** Leaving the page stops it. */
  signal?: AbortSignal;
  /** 0..1 of the file sent, for the button. */
  onProgress?: (fraction: number) => void;
  // Injected in tests.
  makeXhr?: () => XhrLike;
  now?: () => number;
  every?: (fn: () => void, ms: number) => unknown;
  stop?: (id: unknown) => void;
};

export const STALL_MS = 20_000, CONNECT_MS = 45_000, ANSWER_MS = 60_000;

/** One try: resolves "ok", "failed" (an answer that isn't 2xx, a network error, a stall, the deadline) or "aborted". */
function tryOnce(url: string, body: Blob, o: Required<Pick<PutOptions, "contentType" | "deadline" | "stallMs" | "connectMs" | "answerMs" | "makeXhr" | "now" | "every" | "stop">> & PutOptions): Promise<"ok" | "failed" | "aborted"> {
  return new Promise((resolve) => {
    const xhr = o.makeXhr();
    // How long silence is allowed depends on the phase: connecting, sending, or waiting for the answer.
    let last = o.now(), settled = false, why: "failed" | "aborted" = "failed", phase: "connect" | "send" | "answer" = "connect";
    const finish = (r: "ok" | "failed" | "aborted") => {
      if (settled) return;
      settled = true;
      o.stop(timer);
      o.signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };
    const onAbort = () => { why = "aborted"; xhr.abort(); finish("aborted"); };
    const timer = o.every(() => {
      const t = o.now();
      const allowed = phase === "connect" ? o.connectMs : phase === "answer" ? o.answerMs : o.stallMs;
      if (t - last > allowed || t > o.deadline) { why = "failed"; xhr.abort(); finish("failed"); }
    }, 1000);
    xhr.upload.onprogress = (e) => {
      last = o.now();
      phase = e.total > 0 && e.loaded >= e.total ? "answer" : "send";
      if (e.total > 0) o.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? "ok" : "failed");
    xhr.onerror = () => finish("failed");
    xhr.onabort = () => finish(why);
    if (o.signal?.aborted) return finish("aborted");
    o.signal?.addEventListener("abort", onAbort);
    try {
      xhr.open("PUT", url);
      xhr.setRequestHeader("content-type", o.contentType);
      xhr.send(body);
    } catch {
      finish("failed");
    }
  });
}

/** Uploads `body` with PUT; true once a try is answered 2xx. A hung try is dropped (by phase), not waited out. */
export async function putWithStallGuard(url: string, body: Blob, options: PutOptions): Promise<boolean> {
  const o = {
    tries: 3, stallMs: STALL_MS, connectMs: CONNECT_MS, answerMs: ANSWER_MS,
    makeXhr: () => new XMLHttpRequest() as unknown as XhrLike,
    now: () => Date.now(),
    every: (fn: () => void, ms: number) => setInterval(fn, ms),
    stop: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
    ...options,
  };
  for (let i = 0; i < o.tries; i++) {
    if (o.signal?.aborted || o.deadline - o.now() < 5_000) return false;
    const r = await tryOnce(url, body, o);
    if (r === "ok") return true;
    if (r === "aborted") return false;
  }
  return false;
}

/**
 * An export's two files (export-button.tsx): the demo part first, one stall-guarded try that can never hold up the
 * video (the server finishes the job as soon as the video lands, so the demo must be there first; a failed demo is
 * only a missing demo), then the video with up to 3 tries. True once the video is stored.
 */
export async function uploadExportFiles(files: { video: Blob; demo?: Blob | null }, links: { upload: string; demoUpload?: string | null }, o: Omit<PutOptions, "contentType" | "deadline" | "tries" | "onProgress"> & { until: number; onProgress?: (f: number) => void; now?: () => number }): Promise<boolean> {
  const now = o.now ?? (() => Date.now());
  if (files.demo && links.demoUpload) await putWithStallGuard(links.demoUpload, files.demo, { ...o, contentType: "video/mp4", deadline: Math.min(o.until, now() + 2 * 60_000 + files.demo.size / 200), tries: 1, onProgress: undefined });
  if (o.signal?.aborted) return false;
  return putWithStallGuard(links.upload, files.video, { ...o, contentType: "video/mp4", deadline: o.until, onProgress: o.onProgress });
}

/**
 * An export's upload that outlives the run page (founder 2026-11-15: "i changed pages to scheduled post while it was
 * spinning"; the export then hung for 15 minutes). It takes no page signal, so changing page in the app doesn't stop
 * it; only closing or reloading the tab does. Meanwhile `ping(sent)` tells the server it is alive, at once and every
 * 15 s (export-alive.ts): a closed tab's job then ends about 3 minutes later instead of 15, and a reopened run page
 * shows how much is sent. A ping that fails is ignored; the next one follows.
 */
export async function uploadWhileAlive(files: { video: Blob; demo?: Blob | null }, links: { upload: string; demoUpload?: string | null }, o: { until: number; ping: (sent: number) => Promise<unknown>; onProgress?: (f: number) => void; now?: () => number; every?: (fn: () => void, ms: number) => unknown; stop?: (id: unknown) => void; upload?: typeof uploadExportFiles; makeXhr?: () => XhrLike }): Promise<boolean> {
  const now = o.now ?? (() => Date.now());
  const every = o.every ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stop = o.stop ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
  let sent = 0, last = now();
  const beat = () => { last = now(); void Promise.resolve().then(() => o.ping(sent)).catch(() => undefined); };
  beat();
  const timer = every(beat, ALIVE_PING_MS);
  // Progress events keep coming in a hidden tab, whose timers may slow to once a minute: they ping too.
  const onProgress = (f: number) => { sent = f; if (now() - last >= ALIVE_PING_MS) beat(); o.onProgress?.(f); };
  try {
    return await (o.upload ?? uploadExportFiles)(files, links, { until: o.until, onProgress, ...(o.now ? { now: o.now } : {}), ...(o.every ? { every: o.every } : {}), ...(o.stop ? { stop: o.stop } : {}), ...(o.makeXhr ? { makeXhr: o.makeXhr } : {}) });
  } finally {
    stop(timer);
  }
}
