import "server-only";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ffmpegPath } from "@/lib/server/ffmpeg";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { deleteObject, putObject, signedGet } from "@/lib/server/r2";
import { finalArgs, plan, stepArgs, type Probe, type Spec } from "../../../render/render.mjs";
import { MAX_FILE_BYTES, MAX_JOB_BYTES, countOverlayPixels, validProbe } from "../../../render/limits.mjs";

/**
 * The fast export lane (founder 2026-11-03: 1080x1920 in about a minute, no paid server). The very job the Render
 * worker would run (same plan, same ffmpeg arguments from render/render.mjs), but every piece renders in its own
 * Vercel function at the same time, then one function joins them, adds texts and sound, and uploads the video to the
 * job's output link. If it fails or stalls, advanceExport hands the job to the Render worker instead.
 */
export type ExportPayload = { id: string; spec: Spec; output: { url: string; contentType: string }; meta: { seconds: number }; lane?: string; laneAt?: number; upload?: { key: string; size: number } };

/** Jobs with more pieces than this skip the fast lane (each piece is its own function and download). */
export const FAST_MAX_STEPS = 24;
/** Pieces rendering at once. */
const FAST_CONCURRENCY = 12;

/** Calls between the app's own functions carry the render secret. */
export function internalOk(request: Request) {
  const secret = process.env.RENDER_SECRET ?? "";
  const got = Buffer.from(request.headers.get("x-mavya-internal") ?? "");
  const want = Buffer.from(secret);
  return secret.length >= 16 && got.length === want.length && timingSafeEqual(got, want);
}
const origin = () => `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "mavya.app"}`;
export const callInternal = (route: string, body: unknown, ms: number) =>
  fetch(`${origin()}${route}`, { method: "POST", headers: { "x-mavya-internal": process.env.RENDER_SECRET ?? "", "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });

const stepKey = (job: string, i: number) => `exports/${job}/s${i}.mkv`;

async function payloadOf(job: string): Promise<ExportPayload | null> {
  const { data, error } = await createSupabaseAdminClient().from("export_jobs").select("payload,state").eq("id", job).maybeSingle<{ payload: ExportPayload; state: string }>();
  if (error) throw error;
  return data?.state === "running" && data.payload.lane === "vercel" ? data.payload : null;
}

function ffmpeg(args: string[], ms: number): Promise<string> {
  return ffmpegPath().then((bin) => new Promise((resolve, reject) => {
    const p = spawn(bin, ["-threads", "2", "-filter_threads", "1", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), ms);
    p.stderr.on("data", (d) => { err = (err + d).slice(-20000); });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(err); else reject(Object.assign(new Error(err.slice(-800) || "ffmpeg failed"), { stderr: err })); });
  }));
}

/** Bytes a phase may download in all; every chunk is charged as it arrives, so parallel downloads share it. */
type Budget = { bytes: number; max: number };
const budgetOf = (max: number): Budget => ({ bytes: 0, max });

/** Downloads one input within the worker's per-file limit (render/limits.mjs) and its phase's shared budget. */
async function download(url: string, file: string, budget: Budget, ms = 120_000) {
  if (!/^https:\/\//.test(url)) throw new Error("bad input link");
  const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(1000, ms)) });
  if (!res.ok || !res.body) throw new Error(`input download failed (${res.status})`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) throw new Error("input too large");
  let bytes = 0;
  const count = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, out) {
      bytes += chunk.byteLength;
      budget.bytes += chunk.byteLength;
      if (bytes > MAX_FILE_BYTES || budget.bytes > budget.max) throw new Error("input too large");
      out.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(count) as never), createWriteStream(file));
  return file;
}

/**
 * A text image's size from its PNG header (the worker's decoded-pixel budget). Anything that isn't a PNG is refused:
 * ffmpeg decodes by content, so a JPEG named .png would be counted wrong (2026-11-04 Codex: 1x1 counted, 512x512 drawn).
 */
async function pngSize(file: string): Promise<[number, number]> {
  const head = (await readFile(file)).subarray(0, 24);
  const png = head.length === 24 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && head.toString("latin1", 12, 16) === "IHDR";
  if (!png) throw new Error("text image is not a PNG");
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

/** Like the worker's probe: sound or not, and the length (a short song loops). */
async function probe(file: string): Promise<Probe> {
  let out = "";
  try { out = await ffmpeg(["-hide_banner", "-i", file], 20_000); } catch (e) { out = (e as { stderr?: string }).stderr ?? ""; }
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  const size = /Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(out);
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null;
  // The worker's limits on what it will decode (render/limits.mjs validProbe).
  if (!validProbe(size ? +size[1] : 0, size ? +size[2] : 0, duration ?? 0)) throw new Error("input outside the render limits");
  return { file, hasAudio: /Stream #.*Audio:/.test(out), duration };
}

/** One piece (or black gap) of the job, uploaded for the join. */
export async function renderStep(job: string, i: number, until = Date.now() + 280_000): Promise<{ download: number; render: number; upload: number } | null> {
  const p = await payloadOf(job);
  if (!p) return null;
  const step = plan(p.spec)[i];
  if (!step) return null;
  const left = () => until - Date.now();
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-step-"));
  try {
    const t0 = Date.now();
    const src = step.kind === "piece" ? await probe(await download(p.spec.segments[step.si!].url, path.join(dir, "in"), budgetOf(MAX_FILE_BYTES), left())) : null;
    if (left() <= 0) throw new Error("export step too late");
    const t1 = Date.now();
    const out = path.join(dir, "out.mkv");
    await ffmpeg(stepArgs(p.spec, step, src, out), Math.max(1000, Math.min(270_000, left())));
    const t2 = Date.now();
    // Past the coordinator's deadline nobody will join this piece: never leave it behind in storage.
    if (left() <= 0 || !(await payloadOf(job)) || left() <= 0) throw new Error("export step too late");
    await putObject(stepKey(job, i), await readFile(out), "video/x-matroska");
    return { download: t1 - t0, render: t2 - t1, upload: Date.now() - t2 };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The whole job: every piece at once, then the join. Throws when anything fails (the Render worker takes over). */
export async function runFastExport(job: string): Promise<void> {
  const p = await payloadOf(job);
  if (!p) return;
  const steps = plan(p.spec);
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-final-"));
  // How long each phase took, kept on the job (payload.fastTiming) to find what is slow.
  const t0 = Date.now(), timing: Record<string, number> = {};
  // Time left in this function (300 s, a margin kept for cleanup): every phase's timer comes out of it.
  const end = () => t0 + 285_000 - Date.now();
  const mark = (name: string) => { timing[name] = Math.round((Date.now() - t0) / 100) / 10; };
  try {
    // At most FAST_CONCURRENCY pieces at once, all inside one deadline that leaves time for the join.
    const until = t0 + 170_000;
    const done: unknown[] = new Array(steps.length).fill(null);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(FAST_CONCURRENCY, steps.length) }, async () => {
      while (next < steps.length && Date.now() < until) {
        const i = next++;
        done[i] = await callInternal("/api/internal/export-step", { job, i, until }, Math.max(1000, until - Date.now() + 5_000)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!done[i]) break;
      }
    }));
    mark("pieces");
    (timing as Record<string, unknown>).steps = done;
    if (!done.every(Boolean)) throw new Error("a piece failed");
    // The join's own budgets: inputs as the worker allows, the joined pieces (made here, near-lossless) twice that.
    const pieces = budgetOf(2 * MAX_JOB_BYTES), inputs = budgetOf(MAX_JOB_BYTES), pixels = {};
    const files = await Promise.all(steps.map(async (_, i) => download(await signedGet(stepKey(job, i), 900), path.join(dir, `s${i}.mkv`), pieces, end() - 60_000)));
    const overlays = await Promise.all(p.spec.overlays.map((o: { url: string }, i: number) => download(o.url, path.join(dir, `t${i}.png`), inputs, end() - 60_000)));
    for (const file of overlays) countOverlayPixels(pixels, ...(await pngSize(file)));
    const sounds = await Promise.all(p.spec.sounds.map(async (s: { url: string }, i: number) => probe(await download(s.url, path.join(dir, `a${i}`), inputs, end() - 60_000))));
    mark("downloads");
    const list = path.join(dir, "list.txt");
    await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
    const out = path.join(dir, "out.mp4");
    await ffmpeg(finalArgs(p.spec, list, { sounds, overlays }, out).filter((a, k, all) => a !== "-progress" && all[k - 1] !== "-progress"), Math.max(1000, end() - 20_000));
    mark("join");
    const size = (await stat(out)).size;
    // The same output limit as the worker; and the upload must finish inside this function's time.
    if (size > MAX_FILE_BYTES) throw new Error("output too large");
    const put = await fetch(p.output.url, { method: "PUT", headers: { "content-type": p.output.contentType, "content-length": String(size) }, body: await readFile(out), signal: AbortSignal.timeout(Math.max(1000, end())) });
    if (!put.ok) throw new Error(`upload failed (${put.status})`);
    mark("upload");
  } catch (error) {
    (timing as Record<string, unknown>).error = String((error as Error)?.message ?? error).slice(0, 300);
    throw error;
  } finally {
    const db = createSupabaseAdminClient();
    const { data } = await db.from("export_jobs").select("payload").eq("id", job).maybeSingle<{ payload: ExportPayload }>();
    // Only while the job is still this lane's: never overwrite a lane change made meanwhile.
    if (data?.payload.lane === "vercel") await db.from("export_jobs").update({ payload: { ...data.payload, fastTiming: timing } }).eq("id", job).eq("payload->>lane", "vercel");
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await Promise.all(steps.map((_, i) => deleteObject(stepKey(job, i)).catch(() => undefined)));
  }
}

/** The fast lane gave up: the job goes to the Render worker on its next check. */
export async function laneFailed(job: string) {
  const db = createSupabaseAdminClient();
  const { data } = await db.from("export_jobs").select("payload").eq("id", job).maybeSingle<{ payload: ExportPayload }>();
  if (data?.payload.lane === "vercel") await db.from("export_jobs").update({ payload: { ...data.payload, lane: "vercel-failed" } }).eq("id", job).eq("payload->>lane", "vercel");
}
