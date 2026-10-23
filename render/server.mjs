// Mavya render server (Render.com web service, rootDir render/). One job at a time:
//   POST /jobs   {spec, output: {url, contentType}, meta}  -> {id}     (Authorization: Bearer RENDER_SECRET)
//   GET  /jobs/:id                                          -> {state: queued|running|done|failed, progress, meta, error?}
//   GET  /health
// A job downloads its inputs (short-lived R2 links), runs ffmpeg (render.mjs) and uploads the MP4 to the signed PUT
// link it was given. Jobs live in memory for 6 hours; the app treats a missing job as failed.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import { finalArgs, plan, stepArgs } from "./render.mjs";

const SECRET = process.env.RENDER_SECRET ?? "";
const PORT = Number(process.env.PORT ?? 3200);
const KEEP_MS = 6 * 3600_000;
const MAX_INPUT = 600 * 1024 * 1024;

/** @type {Map<string, {state: string, progress: number, meta: unknown, error?: string, at: number, spec: any, output: any}>} */
const jobs = new Map();
const queue = [];
let busy = false;

const authed = (req) => {
  const got = Buffer.from(req.headers.authorization ?? "");
  const want = Buffer.from(`Bearer ${SECRET}`);
  return SECRET.length >= 16 && got.length === want.length && timingSafeEqual(got, want);
};
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2_000_000) throw new Error("too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function run(args, onOut) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stdout.on("data", (d) => onOut?.(String(d)));
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(err.trim().split("\n").slice(-3).join(" ") || `ffmpeg exited ${code}`))));
  });
}

/** Has an audio stream, and how long the file is (ffmpeg prints both reading the header). */
async function probe(file) {
  const out = await new Promise((resolve) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let s = "";
    p.stderr.on("data", (d) => (s += d));
    p.on("close", () => resolve(s));
    p.on("error", () => resolve(s));
  });
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  return { file, hasAudio: /Stream #.*Audio:/.test(out), duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null };
}

async function download(url, file) {
  if (!/^https?:\/\//.test(url)) throw new Error("bad input link");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`input download failed (${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_INPUT || !res.body) throw new Error("input too large");
  let seen = 0;
  const cap = new Transform({
    transform(chunk, _enc, done) {
      seen += chunk.length;
      done(seen > MAX_INPUT ? new Error("input too large") : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), cap, createWriteStream(file));
  return file;
}

async function work(id) {
  const job = jobs.get(id);
  job.state = "running";
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-render-"));
  try {
    const { spec, output } = job;
    // Each file once, even when several pieces use it.
    const cache = new Map();
    let k = 0;
    const get = (url) => {
      if (!cache.has(url)) cache.set(url, download(url, path.join(dir, `in${k++}`)).then(probe));
      return cache.get(url);
    };
    const [segments, sounds, overlays] = await Promise.all([
      Promise.all(spec.segments.map((s) => get(s.url))),
      Promise.all(spec.sounds.map((s) => get(s.url))),
      Promise.all(spec.overlays.map((o) => get(o.url).then((p) => p.file))),
    ]);
    job.progress = 0.05;
    // Pieces one by one (60% of the bar), then the final pass (35%).
    const steps = plan(spec);
    const files = [];
    for (const [i, step] of steps.entries()) {
      const file = path.join(dir, `step${i}.mkv`);
      await run(stepArgs(spec, step, step.kind === "piece" ? segments[step.si] : null, file));
      files.push(file);
      job.progress = 0.05 + ((i + 1) / steps.length) * 0.6;
    }
    const list = path.join(dir, "list.txt");
    await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
    const out = path.join(dir, "out.mp4");
    await run(finalArgs(spec, list, { sounds, overlays }, out), (text) => {
      const m = /out_time_us=(\d+)/.exec(text.split("\n").filter((l) => l.startsWith("out_time_us=")).pop() ?? "");
      if (m && spec.total > 0) job.progress = Math.min(0.97, 0.65 + (Number(m[1]) / 1e6 / spec.total) * 0.32);
    });
    const size = (await stat(out)).size;
    const put = await fetch(output.url, { method: "PUT", headers: { "content-type": output.contentType, "content-length": String(size) }, body: await readFile(out) });
    if (!put.ok) throw new Error(`upload failed (${put.status})`);
    job.progress = 1;
    job.state = "done";
    job.size = size;
  } catch (e) {
    job.state = "failed";
    job.error = String(e?.message ?? e).slice(0, 500);
    console.error("job", id, job.error);
  } finally {
    job.spec = job.output = null;
    await rm(dir, { recursive: true, force: true });
  }
}

async function next() {
  if (busy) return;
  busy = true;
  while (queue.length) await work(queue.shift());
  busy = false;
}

setInterval(() => {
  const old = Date.now() - KEEP_MS;
  for (const [id, j] of jobs) if (j.at < old && j.state !== "running") jobs.delete(id);
}, 600_000).unref();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/health") return send(res, 200, { ok: true, queued: queue.length, busy });
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    if (req.method === "POST" && url.pathname === "/jobs") {
      const b = await body(req);
      if (!b?.spec?.segments?.length || !b?.output?.url) return send(res, 400, { error: "bad job" });
      const id = randomUUID();
      jobs.set(id, { state: "queued", progress: 0, meta: b.meta ?? null, at: Date.now(), spec: b.spec, output: b.output });
      queue.push(id);
      void next();
      return send(res, 200, { id });
    }
    const m = /^\/jobs\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      const j = jobs.get(m[1]);
      if (!j) return send(res, 404, { error: "not found" });
      return send(res, 200, { state: j.state, progress: Math.round(j.progress * 100) / 100, meta: j.meta, error: j.error, size: j.size, ahead: j.state === "queued" ? queue.indexOf(m[1]) : 0 });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 400, { error: String(e?.message ?? e) });
  }
}).listen(PORT, () => console.log(`render server on ${PORT}`));
