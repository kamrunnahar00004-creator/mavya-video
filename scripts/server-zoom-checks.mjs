// The server export's keyframed zoom must not wobble (founder 2026-11-11). zoompan snapped the zoom window to whole
// pixels: on a still picture the zoom drifted 0.44 px per frame at 360 wide (1-2 px of the video); the perspective
// look resamples from exact corners (0.11; a perfect zoom measures 0.10). Renders with the server's own ffmpeg
// commands (render.mjs countArgs/stepArgs) and measures with the browser check's tracker. Offline, ~5 s.
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import url from "node:url";
const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const { plan, countArgs, countFrames, stepArgs } = await import(path.join(root, "render/render.mjs"));
const ff = path.join(root, "node_modules/ffmpeg-static/ffmpeg");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-zoom-"));
let checks = 0; const ok = (c, m) => { checks++; if (!c) { console.error("server-zoom-checks FAILED:", m); process.exitCode = 1; } };
try {
  execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=0.04", "-frames:v", "1", "-vf", "drawgrid=w=40:h=40:t=2:c=white@0.6", `${dir}/still.png`]);
  execFileSync(ff, ["-v", "error", "-y", "-loop", "1", "-i", `${dir}/still.png`, "-t", "3", "-r", "30", "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "12", "-preset", "veryfast", `${dir}/still.mp4`]);
  const look = { zoom: 0, panX: 0, panY: 0, keys: [{ t: 0.3, zoom: 0, panX: 0, panY: 0 }, { t: 2.3, zoom: 32, panX: 0, panY: 0 }] };
  const spec = { width: 1080, height: 1920, fps: 30, total: 3, segments: [{ url: "x", gap: 0, speed: 1, volume: 0, look, pieces: [{ start: 0, end: 3 }] }], sounds: [], overlays: [] };
  const step = plan(spec)[0], src = { file: `${dir}/still.mp4`, hasAudio: false, duration: 3, width: 1080, height: 1920, hdr: false };
  execFileSync(ff, countArgs(spec, step, src, `${dir}/count.txt`));
  const args = stepArgs(spec, step, src, `${dir}/piece.mkv`, countFrames(fs.readFileSync(`${dir}/count.txt`, "utf8")), undefined);
  ok(args.some((a) => String(a).includes("perspective=")) && !args.some((a) => String(a).includes("zoompan")), "the keyframed look resamples with perspective, never zoompan");
  execFileSync(ff, args);
  const m = JSON.parse(execFileSync("node", [path.join(root, "scripts/browser/zoom-preview/motion.mjs"), ff, `${dir}/piece.mkv`, "360", "640"], { maxBuffer: 1 << 26 }));
  fs.writeFileSync(`${dir}/m.json`, JSON.stringify(m));
  const z = (t) => { const p = Math.min(1, Math.max(0, (t - 0.3) / 2)); return 1 + 0.32 * p * p * (3 - 2 * p); };
  let st = 0, se = 0, c = 0, lost = 0;
  m.forEach((r, i) => { const t = (i + 1) / 30; if (t < 0.2 || t > 2.5) return; if (!r) { lost++; return; } st += r.tx ** 2 + r.ty ** 2; se += (r.k - (z(t) / z(t - 1 / 30) - 1) * 1000) ** 2; c++; });
  const shift = Math.sqrt(st / c), stepErr = Math.sqrt(se / c);
  ok(c === 70 && lost === 0, `every frame measured (${c}, ${lost} lost)`);
  ok(shift <= 0.25, `zoom holds still sideways: ${shift.toFixed(2)} px per frame (zoompan: 0.44)`);
  ok(stepErr <= 0.8, `zoom grows evenly: step error ${stepErr.toFixed(2)} (zoompan: 0.62, perfect 0.51)`);
  // On time: fit the exact zoom of frames 20 and 40 against the unzoomed picture; it must be the plan's, not a frame
  // early or late (perspective counts frames from 1; reading it from 0 gave 3.34 % at frame 20 against 2.83 %).
  const W = 1080, H = 1920, N = W * H;
  const raw = (f, n) => execFileSync(ff, ["-v", "error", "-i", f, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 26 });
  const a0 = raw(`${dir}/still.mp4`, 0);
  const bil = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * W + x0; return (a0[i] * (1 - fx) + a0[i + 1] * fx) * (1 - fy) + (a0[i + W] * (1 - fx) + a0[i + W + 1] * fx) * fy; };
  for (const n of [20, 40]) {
    const b = raw(`${dir}/piece.mkv`, n), want = z(n / 30);
    const cost = (s) => { let e = 0, c = 0; for (let y = 200; y < H - 200; y += 8) for (let x = 120; x < W - 120; x += 8) { e += Math.abs(b[y * W + x] - bil(W / 2 + (x + 0.5 - W / 2) / s - 0.5, H / 2 + (y + 0.5 - H / 2) / s - 0.5)); c++; } return e / c; };
    let best = [Infinity, 0]; for (let d = -0.012; d <= 0.012 + 1e-9; d += 0.0005) { const v = cost(want + d); if (v < best[0]) best = [v, want + d]; }
    ok(Math.abs(best[1] - want) <= 0.001, `frame ${n} on time: zoom ${((best[1] - 1) * 100).toFixed(2)} %, plan ${((want - 1) * 100).toFixed(2)} %`);
  }
  // A sped-up clip (founder 2026-11-14: "the zoom is shaking", a 30 fps phone clip at 1.35x): the shown source frames
  // step 1, 1, 2 apart, and a zoom read from them stepped too (step error 2.5 on this still). The zoom must follow each
  // output frame's own time, in the server's frames and in the browser's schedule (render/frames.mjs time) alike.
  const { frameSchedule } = await import(path.join(root, "render/frames.mjs"));
  const speed = 1.35, fast = { ...spec, total: 3 / speed, segments: [{ ...spec.segments[0], speed }] };
  const fstep = plan(fast)[0];
  execFileSync(ff, countArgs(fast, fstep, src, `${dir}/count2.txt`));
  const slots = countFrames(fs.readFileSync(`${dir}/count2.txt`, "utf8"));
  execFileSync(ff, stepArgs(fast, fstep, src, `${dir}/fast.mkv`, slots, undefined));
  const fm = JSON.parse(execFileSync("node", [path.join(root, "scripts/browser/zoom-preview/motion.mjs"), ff, `${dir}/fast.mkv`, "360", "640"], { maxBuffer: 1 << 26 }));
  const ft = (n) => (n * slots) / fstep.frames / 30;
  let fe = 0, fc = 0;
  fm.forEach((r, i) => { const n = i + 1, t = ft(n); if (t < 0.2 || t > 2.5 || !r) return; fe += (r.k - (z(t) / z(ft(n - 1)) - 1) * 1000) ** 2; fc++; });
  const fastErr = Math.sqrt(fe / fc);
  ok(fc >= 45, `sped-up clip: every frame measured (${fc})`);
  ok(fastErr <= 0.8, `zoom on a clip at ${speed}x grows evenly: step error ${fastErr.toFixed(2)} (read from the source frame: 2.5)`);
  const pts = Array.from({ length: 90 }, (_, i) => i / 30);
  const sched = frameSchedule(pts, fstep, speed, 30);
  ok(sched.time.every((x, n) => Math.abs(x - ft(n)) < 1e-9), "browser export: keyframe time is the output frame's own place, the server's (in-1)*slots/frames/fps");
  ok(new Set(sched.time.slice(1).map((x, n) => (x - sched.time[n]).toFixed(9))).size === 1, "browser export: keyframe times are evenly spaced at 1.35x");
  if (!process.exitCode) console.log(`server-zoom-checks: ${checks} checks pass (shift ${shift.toFixed(2)} px, step error ${stepErr.toFixed(2)}, at ${speed}x ${fastErr.toFixed(2)})`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
