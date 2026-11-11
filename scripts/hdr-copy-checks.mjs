// iPhone HDR uploads, end to end on the real render server (founder 2026-11-11: after a refresh the editor played the
// server's copy and the colours "bursted": the copies were tone-mapped ~40 levels too bright). Starts render/server.mjs
// as it runs in production, asks it for an upload's copies over HTTPS exactly as src/lib/server/previews.ts does, takes
// the files it uploads back, and checks every band of an iPhone-like HLG clip (scripts/hdr-fixture.mjs) against what
// Chrome shows for the original: the editor copy, the export copy, and the library thumbnail made from the original
// (src/lib/server/thumbs.ts). Also fails when the server stops telling HDR apart (the copy would come out flat).
// The same comparison in real Chrome: bash scripts/browser/hdr-copy.sh. Offline, ~20 s.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs"; import https from "node:https"; import os from "node:os"; import path from "node:path"; import url from "node:url";
import * as render from "../render/render.mjs";
import { BANDS, bandColours, makeHlgClip } from "./hdr-fixture.mjs";
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const ff = path.join(root, "node_modules/ffmpeg-static/ffmpeg");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-copy-"));
const TOLERANCE = 14; // levels of 255, per channel; the old mobius copies were off by up to 69
let checks = 0; const ok = (c, m) => { checks++; if (!c) { console.error("hdr-copy-checks FAILED:", m); process.exitCode = 1; } };
const near = (what, got) => BANDS.forEach((b, i) => {
  const off = Math.max(...got[i].map((c, k) => Math.abs(c - b.chrome[k])));
  ok(off <= TOLERANCE, `${what}, ${b.name}: ${got[i].join(" ")} where Chrome shows the original as ${b.chrome.join(" ")} (off by ${off}, allowed ${TOLERANCE})`);
});
let server = null, sink = null;
// The render server and its ffmpeg runs are one process group (detached), stopped together; its temp files live in
// this run's folder, removed with it on every exit, the watchdog's too (Codex 2026-11-11).
const children = new Set(); // the thumbnail's ffmpeg runs, started from this process
const stop = () => { try { if (server?.pid) process.kill(-server.pid, "SIGKILL"); } catch {} for (const c of children) c.kill("SIGKILL"); sink?.close(); sink?.closeAllConnections?.(); fs.rmSync(dir, { recursive: true, force: true }); };
const watchdog = setTimeout(() => { console.error("hdr-copy-checks: no result within 3 min"); stop(); process.exit(1); }, 180_000);
try {
  makeHlgClip(ff, `${dir}/in.mov`);
  ok(render.isHdr(probe(`${dir}/in.mov`)), "an iPhone HLG .mov is told apart as HDR");

  // Storage stand-in: HTTPS (the server takes only https links), serves the upload, keeps what the server PUTs.
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${dir}/k.pem`, "-out", `${dir}/c.pem`, "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore", timeout: 30_000 });
  const got = {};
  sink = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (req, res) => {
    if (req.method === "GET" && req.url === "/in.mov") { res.writeHead(200, { "content-type": "video/quicktime", "content-length": fs.statSync(`${dir}/in.mov`).size }); return fs.createReadStream(`${dir}/in.mov`).pipe(res); }
    if (req.method === "PUT") { const parts = []; req.on("data", (d) => parts.push(d)); req.on("end", () => { got[req.url.slice(1)] = Buffer.concat(parts); res.end(); }); return; }
    res.writeHead(404).end();
  });
  await new Promise((r) => sink.listen(0, "127.0.0.1", r));
  const store = `https://127.0.0.1:${sink.address().port}`;

  fs.mkdirSync(`${dir}/tmp`);
  // PORT=0: any free port, read from the server's first line.
  server = spawn(process.execPath, [path.join(root, "render/server.mjs")], { detached: true, env: { ...process.env, PORT: "0", TMPDIR: `${dir}/tmp`, RENDER_SECRET: "hdr-check-secret-0123", NODE_TLS_REJECT_UNAUTHORIZED: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100 && !/render server on \d+/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  const base = `http://127.0.0.1:${/render server on (\d+)/.exec(log)?.[1]}`;
  const ask = () => fetch(`${base}/previews`, { method: "POST", headers: { authorization: "Bearer hdr-check-secret-0123", "content-type": "application/json" },
    body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000001.mov", input: `${store}/in.mov`, output: { url: `${store}/p480.mp4`, contentType: "video/mp4" }, master: { url: `${store}/v1080.mp4`, contentType: "video/mp4" } }) }).then((r) => r.json());
  const first = await ask(); let state = first.state; if (!state) console.error("render server said", JSON.stringify(first));
  for (let i = 0; i < 300 && state !== "done" && state !== "failed"; i++) { await new Promise((r) => setTimeout(r, 300)); state = (await ask()).state; }
  ok(state === "done", `the render server made the copies (state ${state}; ${log.slice(-300)})`);
  for (const name of ["p480", "v1080"]) {
    if (!got[`${name}.mp4`]) { ok(false, `the server uploaded no ${name} copy`); continue; }
    fs.writeFileSync(`${dir}/${name}.mp4`, got[`${name}.mp4`]);
    const info = probe(`${dir}/${name}.mp4`);
    ok(/Video: h264.*yuv420p\(tv, bt709/.test(info), `${name} copy is standard-range BT.709 H.264 (${/Video:.*/.exec(info)?.[0].slice(0, 80)})`);
    near(name === "p480" ? "editor copy" : "export copy", bandColours(ff, `${dir}/${name}.mp4`));
  }

  const node = (id) => require(id);
  // thumbs.ts runs promisify(execFile): the same {stdout, stderr} results and errors, with each child remembered.
  const { execFile } = node("node:child_process");
  function tracked(...a) { const c = execFile(...a); children.add(c); c.once("exit", () => children.delete(c)); return c; }
  tracked[node("node:util").promisify.custom] = (file, args, opts) => new Promise((resolve, reject) => {
    tracked(file, args, opts, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
  });
  // The library thumbnail of an upload whose copy is not made yet: from the original, tone-mapped (thumbs.ts).
  const thumbs = require("./check-module.cjs").load(path.join(root, "src/lib/server/thumbs.ts"), {
    "node:child_process": { ...node("node:child_process"), execFile: tracked }, "node:fs": node("node:fs"), "node:fs/promises": node("node:fs/promises"), "node:stream": node("node:stream"),
    "node:stream/promises": node("node:stream/promises"), "node:os": node("node:os"), "node:path": node("node:path"), "node:util": node("node:util"),
    "@/lib/server/ffmpeg": { ffmpegPath: async () => ff }, "@/lib/server/r2": {}, "@/lib/server/previews": {}, "@/lib/server/store": {}, "../../../render/render.mjs": render,
  }, {}, { process });
  near("thumbnail", bandColours(ff, await thumbs.localThumb(`${dir}/in.mov`)));
} catch (e) { ok(false, String(e?.stack ?? e).slice(0, 400)); }
finally {
  clearTimeout(watchdog);
  stop();
}
// Each band of 3 pictures, plus: HDR told apart, copies made, 2 format checks.
if (!process.exitCode && checks !== BANDS.length * 3 + 4) { console.error(`hdr-copy-checks: ${checks} checks ran, expected ${BANDS.length * 3 + 4}`); process.exitCode = 1; }
if (!process.exitCode) console.log(`hdr-copy-checks: ${checks} checks pass`);

function probe(file) { try { execFileSync(ff, ["-hide_banner", "-i", file], { stdio: "pipe", timeout: 30_000 }); return ""; } catch (e) { return String(e.stderr); } }
