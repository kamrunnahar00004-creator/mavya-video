// Mavya render server (Render.com web service, rootDir render/). One job at a time:
//   POST /jobs   {spec, output: {url, contentType}, meta}  -> {id}     (Authorization: Bearer RENDER_SECRET)
//   GET  /jobs/:id                                          -> {state: queued|running|done|failed, progress, meta, error?}
//   GET  /health
// A job downloads its inputs (short-lived R2 links), runs ffmpeg (render.mjs) and uploads the MP4 to the signed PUT
// link it was given. Jobs live in memory for 6 hours; the app treats a missing job as failed.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import { finalArgs, plan, stepArgs } from "./render.mjs";

const SECRET = process.env.RENDER_SECRET ?? "";
const PORT = Number(process.env.PORT ?? 3200);
const KEEP_MS = 6 * 3600_000;
import { JOB_MS, MAX_QUEUE, MAX_FILE_BYTES, MAX_JOB_BYTES, validJob, validProbe } from "./limits.mjs";

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

function run(args, onOut, signal, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ["-threads", "2", "-filter_threads", "1", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "", head="";
    const kill = () => p.kill("SIGKILL");
    const timer = setTimeout(kill, timeout);
    signal.addEventListener("abort",kill,{once:true});
    if(signal.aborted)kill();
    p.stdout.on("data", d => onOut?.(String(d)));
    p.stderr.on("data", d => {err=(err+d).slice(-65536);head=(head+d).slice(0,65536);});
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener("abort",kill);};
    p.on("error", e=>{cleanup();reject(e);});
    p.on("close", code=>{cleanup();if(code===0)resolve(head);else reject(Object.assign(new Error(err.slice(-2000)||"Media process timed out"),{stderr:head}));});
  });
}
async function probe(file, signal) {
  // ffmpeg exits nonzero after probing with no output. Keep its bounded stderr anyway.
  let out="";
  try {out=await run(["-hide_banner","-i",file],null,signal,15_000);}
  catch(e){out=e.stderr??e.message;}
  if(!/Stream #.*(?:Audio|Video):/.test(out))throw new Error("Unrecognized or excessive media metadata");
  const d=/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  const dim=/Video:.*?(\d{2,5})x(\d{2,5})/.exec(out);
  const duration=d?+d[1]*3600 + +d[2]*60 + +d[3]:null;
  if(!validProbe(dim?+dim[1]:0,dim?+dim[2]:0,duration))throw new Error("Input dimensions or duration exceed limits");
  return {file,hasAudio:/Stream #.*Audio:/.test(out),duration};
}

async function download(url, file, signal, budget) {
  if (!/^https?:\/\//.test(url)) throw new Error("bad input link");
  const res = await fetch(url, {signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)])});
  if (!res.ok) throw new Error(`input download failed (${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_FILE_BYTES || !res.body) throw new Error("input too large");
  let seen = 0;
  const cap = new Transform({
    transform(chunk, _enc, done) {
      seen += chunk.length;
      done(seen > MAX_FILE_BYTES || (budget.bytes += chunk.length) > MAX_JOB_BYTES ? new Error("input too large") : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), cap, createWriteStream(file), {signal});
  return file;
}

async function work(id) {
  const job = jobs.get(id);
  if (!job) return;
  job.state = "running";
  const controller=new AbortController();
  const deadline=setTimeout(()=>controller.abort(),JOB_MS);
  const signal=controller.signal;
  const budget={bytes:0};
  let dir;
  try {
    dir=await mkdtemp(path.join(tmpdir(), "mavya-render-"));
    const { spec, output } = job;
    // Each file once, even when several pieces use it.
    const cache = new Map();
    let k = 0;
    let active=0;
    const waiting=[];
    const bounded=async work=>{
      if(active>=4)await new Promise(resolve=>waiting.push(resolve));
      active++;
      try{return await work();}finally{active--;waiting.shift()?.();}
    };
    const get = (url) => {
      if (!cache.has(url)) cache.set(url, bounded(()=>download(url, path.join(dir, `in${k++}`),signal,budget).then(file=>probe(file,signal))));
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
      await run(stepArgs(spec, step, step.kind === "piece" ? segments[step.si] : null, file),null,signal);
      files.push(file);
      job.progress = 0.05 + ((i + 1) / steps.length) * 0.6;
    }
    const list = path.join(dir, "list.txt");
    await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
    const out = path.join(dir, "out.mp4");
    await run(finalArgs(spec, list, { sounds, overlays }, out), (text) => {
      const m = /out_time_us=(\d+)/.exec(text.split("\n").filter((l) => l.startsWith("out_time_us=")).pop() ?? "");
      if (m && spec.total > 0) job.progress = Math.min(0.97, 0.65 + (Number(m[1]) / 1e6 / spec.total) * 0.32);
    },signal,300_000);
    const size = (await stat(out)).size;
    if(size>MAX_FILE_BYTES)throw new Error("Output too large");
    const put = await fetch(output.url, { method: "PUT", headers: { "content-type": output.contentType, "content-length": String(size) }, body: createReadStream(out), duplex: "half", signal: AbortSignal.any([signal,AbortSignal.timeout(60_000)]) });
    if (!put.ok) throw new Error(`upload failed (${put.status})`);
    job.progress = 1;
    job.state = "done";
    job.size = size;
  } catch (e) {
    job.state = "failed";
    job.error = String(e?.message ?? e).slice(0, 500);
    console.error("job", id, job.error);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    job.spec = job.output = null;
    if(dir)await rm(dir, { recursive: true, force: true }).catch(()=>undefined);
  }
}

async function next() {
  if (busy) return;
  busy = true;
  try { while (queue.length) await work(queue.shift()); } finally { busy = false; }
}

setInterval(() => {
  const old = Date.now() - KEEP_MS;
  for (const [id, j] of jobs) if (j.at < old && j.state !== "running") {
    jobs.delete(id);
    const at=queue.indexOf(id);if(at>=0)queue.splice(at,1);
  }
}, 600_000).unref();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/health") return send(res, 200, { ok: true, queued: queue.length, busy });
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    if (req.method === "POST" && url.pathname === "/jobs") {
      const b = await body(req);
      if (!validJob(b)) return send(res, 400, { error: "bad job" });
      const digest=createHash("sha256").update(JSON.stringify(b)).digest("hex");
      if(b.id && jobs.has(b.id)){
        const prior=jobs.get(b.id);
        return prior.digest===digest?send(res,200,{id:b.id}):send(res,409,{error:"job identity changed"});
      }
      if(queue.length>=MAX_QUEUE||jobs.size>=2000)return send(res,429,{error:"queue full"});
      if([...jobs.values()].some(j=>j.meta?.who===b.meta.who&&["queued","running"].includes(j.state)))return send(res,429,{error:"one export at a time"});
      const id = /^[0-9a-f-]{36}$/i.test(b.id??"") ? b.id : randomUUID();
      jobs.set(id, { state: "queued", progress: 0, meta: b.meta ?? null, at: Date.now(), spec: b.spec, output: b.output, digest });
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
