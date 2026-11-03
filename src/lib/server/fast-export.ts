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

/**
 * The fast export lane (founder 2026-11-03: 1080x1920 in about a minute, no paid server). The very job the Render
 * worker would run (same plan, same ffmpeg arguments from render/render.mjs), but every piece renders in its own
 * Vercel function at the same time, then one function joins them, adds texts and sound, and uploads the video to the
 * job's output link. If it fails or stalls, advanceExport hands the job to the Render worker instead.
 */
export type ExportPayload = { id: string; spec: Spec; output: { url: string; contentType: string }; meta: { seconds: number }; lane?: string; laneAt?: number };

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

async function download(url: string, file: string) {
  if (!/^https:\/\//.test(url)) throw new Error("bad input link");
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error(`input download failed (${res.status})`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
  return file;
}

/** Like the worker's probe: sound or not, and the length (a short song loops). */
async function probe(file: string): Promise<Probe> {
  let out = "";
  try { out = await ffmpeg(["-hide_banner", "-i", file], 20_000); } catch (e) { out = (e as { stderr?: string }).stderr ?? ""; }
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  return { file, hasAudio: /Stream #.*Audio:/.test(out), duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null };
}

/** One piece (or black gap) of the job, uploaded for the join. */
export async function renderStep(job: string, i: number): Promise<{ download: number; render: number; upload: number } | null> {
  const p = await payloadOf(job);
  if (!p) return null;
  const step = plan(p.spec)[i];
  if (!step) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-step-"));
  try {
    const t0 = Date.now();
    const src = step.kind === "piece" ? await probe(await download(p.spec.segments[step.si!].url, path.join(dir, "in"))) : null;
    const t1 = Date.now();
    const out = path.join(dir, "out.mkv");
    await ffmpeg(stepArgs(p.spec, step, src, out), 270_000);
    const t2 = Date.now();
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
  const mark = (name: string) => { timing[name] = Math.round((Date.now() - t0) / 100) / 10; };
  try {
    // Spread over four copies of the piece route (four functions, so not one shared machine).
    const route = (i: number) => (i % 4 ? `/api/internal/export-step-${i % 4}` : "/api/internal/export-step");
    const done = await Promise.all(steps.map((_, i) => callInternal(route(i), { job, i }, 290_000).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    mark("pieces");
    (timing as Record<string, unknown>).steps = done;
    if (!done.every(Boolean)) throw new Error("a piece failed");
    const files = await Promise.all(steps.map(async (_, i) => download(await signedGet(stepKey(job, i), 900), path.join(dir, `s${i}.mkv`))));
    const overlays = await Promise.all(p.spec.overlays.map((o: { url: string }, i: number) => download(o.url, path.join(dir, `t${i}.png`))));
    const sounds = await Promise.all(p.spec.sounds.map(async (s: { url: string }, i: number) => probe(await download(s.url, path.join(dir, `a${i}`)))));
    mark("downloads");
    const list = path.join(dir, "list.txt");
    await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
    const out = path.join(dir, "out.mp4");
    await ffmpeg(finalArgs(p.spec, list, { sounds, overlays }, out).filter((a, k, all) => a !== "-progress" && all[k - 1] !== "-progress"), 270_000);
    mark("join");
    const size = (await stat(out)).size;
    const put = await fetch(p.output.url, { method: "PUT", headers: { "content-type": p.output.contentType, "content-length": String(size) }, body: await readFile(out), signal: AbortSignal.timeout(120_000) });
    if (!put.ok) throw new Error(`upload failed (${put.status})`);
    mark("upload");
  } finally {
    const db = createSupabaseAdminClient();
    const { data } = await db.from("export_jobs").select("payload").eq("id", job).maybeSingle<{ payload: ExportPayload }>();
    if (data) await db.from("export_jobs").update({ payload: { ...data.payload, fastTiming: timing } }).eq("id", job);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await Promise.all(steps.map((_, i) => deleteObject(stepKey(job, i)).catch(() => undefined)));
  }
}

/** The fast lane gave up: the job goes to the Render worker on its next check. */
export async function laneFailed(job: string) {
  const db = createSupabaseAdminClient();
  const { data } = await db.from("export_jobs").select("payload").eq("id", job).maybeSingle<{ payload: ExportPayload }>();
  if (data?.payload.lane === "vercel") await db.from("export_jobs").update({ payload: { ...data.payload, lane: "vercel-failed" } }).eq("id", job);
}
