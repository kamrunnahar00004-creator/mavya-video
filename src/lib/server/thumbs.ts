import "server-only";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ffmpegPath } from "@/lib/server/ffmpeg";
import { objectInfo, putObject, signedGet } from "@/lib/server/r2";
import { previewKey, previewReady, requestPreview } from "@/lib/server/previews";
import { mediaLink } from "@/lib/server/store";
import { TONEMAP, isHdr } from "../../../render/render.mjs";

const run = promisify(execFile);
/** The largest original read to make a picture (a 4K phone clip waits for its light copy). */
const MAX_BYTES = 60 * 1024 * 1024;

/**
 * A still picture of a stored video for lists (My files; founder 2026-11-09: My files was slow and the screen went
 * black). Every card used to be a <video> of the ORIGINAL file: phone clips are 4K HDR, so dozens of them decoded at
 * once, and an HDR video can switch a Windows screen's display mode (black for seconds). A 320-wide JPEG (SDR), made
 * once from the light preview copy when there is one, kept next to the file and served from storage after that.
 */
export const thumbKey = (id: string) => `media/${id.replace(/\.[^.]+$/, "")}.t320.jpg`;
/** ffmpeg arguments: one frame at `at` seconds, 320 wide, tone-mapped to SDR when `hdr`. */
export const thumbArgs = (input: string, out: string, at: number, hdr: boolean) =>
  ["-nostdin", "-hide_banner", "-y", "-threads", "1", "-ss", String(at), "-i", input, "-frames:v", "1", "-vf", `${hdr ? `${TONEMAP},` : ""}scale=320:-2`, "-threads", "1", "-q:v", "4", out];

/** At most this many pictures made at once in one server (Codex 2026-11-09: a cold list asked for 200 at once). */
const AT_ONCE = 2;
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  running++;
  try { return await work(); }
  finally { running--; waiting.shift()?.(); }
}

const made = new Map<string, number>();
const making = new Map<string, Promise<void>>();

/** One picture from a file on disk: at `at` (else the first frame), tone-mapped when `mayBeHdr` and the clip is HDR. */
async function frameFrom(input: string, out: string, at: number, mayBeHdr: boolean) {
  const ff = await ffmpegPath();
  const make = async (from: number) => {
    const first = await run(ff, thumbArgs(input, out, from, false), { timeout: 25_000 }).catch((e: { stderr?: string }) => e);
    // An HDR original (no light copy yet): made again, tone-mapped, so it is not washed out.
    if (mayBeHdr && isHdr(String((first as { stderr?: string }).stderr ?? ""))) await run(ff, thumbArgs(input, out, from, true), { timeout: 25_000 });
  };
  await make(at);
  // A clip shorter than `at` has no frame there: its first frame (Codex 2026-11-09).
  if (!(await stat(out).catch(() => null))?.size) await make(0);
}

/** Local storage (development): the picture next to the file, made once, like the cloud's (limited, tone-mapped). */
export async function localThumb(file: string): Promise<string> {
  const out = `${file}.t320.jpg`;
  if ((await stat(out).catch(() => null))?.size) return out;
  let job = making.get(out);
  if (!job) {
    job = slot(async () => {
      if ((await stat(out).catch(() => null))?.size) return;
      const temp = `${out}.${process.pid}.tmp.jpg`;
      await frameFrom(file, temp, 0.5, true);
      await rename(temp, out);
    }).finally(() => making.delete(out));
    making.set(out, job);
  }
  await job;
  return out;
}

/** The thumbnail's storage link, made first if it does not exist yet. */
export async function thumbLink(id: string, at = 0.5): Promise<string> {
  const key = thumbKey(id);
  if (!made.has(key)) {
    let job = making.get(key);
    if (!job) {
      // A picture already made is found without waiting for a making slot (Codex 2026-11-09).
      job = (async () => { if (!(await objectInfo(key))) await slot(async () => {
        if (await objectInfo(key)) return;
        const fromPreview = await previewReady(id);
        const url = fromPreview ? await signedGet(previewKey(id), 600) : await mediaLink(id, 600);
        const dir = await mkdtemp(path.join(tmpdir(), "mavya-thumb-"));
        try {
          // ffmpeg reads a file on disk: the static build crashes opening https links (found 2026-11-09). The light
          // copy is small; an original is read only up to MAX_BYTES (bigger ones wait for their copy).
          const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
          const size = Number(res.headers.get("content-length") ?? 0);
          if (!res.ok || size > MAX_BYTES) {
            // Too big to read here: ask for its light copy (the editor wants it too); the picture follows once it lands.
            void res.body?.cancel().catch(() => undefined);
            if (!fromPreview) await requestPreview(id);
            throw Error(`thumb source ${res.status} ${size}`);
          }
          const input = path.join(dir, "in");
          // Streamed to disk, never held whole in memory.
          await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(input));
          const out = path.join(dir, "t.jpg");
          await frameFrom(input, out, at, !fromPreview);
          await putObject(key, await readFile(out), "image/jpeg");
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }); })().finally(() => making.delete(key));
      making.set(key, job);
    }
    await job;
    if (made.size > 5000) made.clear();
    made.set(key, 1);
  }
  return signedGet(key, 86400);
}
