// The browser export's frame schedule (render/frames.mjs) against real ffmpeg running the server's own piece
// command (render.mjs stepArgs): every output frame must show the same source frame. Fixtures are lossless gray
// ramps (frame i has luma 2i), at 30, 60, 29.97 fps and a variable rate, B-frames on.
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const root = path.join(__dirname, "..");
  const { plan, stepArgs } = await import(path.join(root, "render/render.mjs"));
  const { frameSchedule } = await import(path.join(root, "render/frames.mjs"));
  const ff = require(path.join(root, "node_modules/ffmpeg-static"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frames-"));
  const enc = ["-c:v", "libx264", "-qp", "0", "-bf", "3", "-pix_fmt", "yuv420p"];
  const make = (name, rate, extra = []) => {
    const file = path.join(dir, name);
    execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", `nullsrc=s=32x32:r=${rate},geq=lum='2*N':cb=128:cr=128`, "-frames:v", "120", ...extra, ...enc, file]);
    return file;
  };
  const sources = {
    "30": make("r30.mp4", 30),
    "60": make("r60.mp4", 60),
    "29.97": make("r2997.mp4", "30000/1001"),
    vfr: make("vfr.mp4", 60, ["-vf", "select='if(lt(t,1),not(mod(n,2)),1)'", "-fps_mode", "vfr"]),
  };
  const lumas = (file, args = []) => [...execFileSync(ff, ["-v", "error", "-i", file, ...args, "-vf", "scale=1:1", "-pix_fmt", "gray", "-f", "rawvideo", "-"], { maxBuffer: 1e8 })];
  let checked = 0, failed = 0;
  for (const [name, file] of Object.entries(sources)) {
    const info = spawnSync(ff, ["-v", "info", "-i", file, "-vf", "showinfo", "-fps_mode", "passthrough", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const pts = [...info.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
    const value = lumas(file, ["-fps_mode", "passthrough"]);
    for (const speed of [0.5, 0.75, 0.9, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.5, 1.75, 2]) {
      for (const [start, end] of [[0.2, 1.4], [0.213, 1.377], [0, 0.9], [0.51, 1.02], [1.3, 1.95]]) {
        const spec = { width: 32, height: 32, fps: 30, total: (end - start) / speed, segments: [{ gap: 0, speed, volume: 0, look: null, pieces: [{ start, end }] }], sounds: [], overlays: [] };
        const step = plan(spec)[0];
        const out = path.join(dir, "out.mkv");
        execFileSync(ff, stepArgs(spec, step, { file, hasAudio: false }, out));
        const server = lumas(out);
        const ours = frameSchedule(pts, step, speed, 30).source.map((i) => value[i]);
        const bad = server.map((v, i) => (Math.abs(v - ours[i]) > 1 ? i : -1)).filter((i) => i >= 0);
        checked++;
        if (server.length !== step.frames || bad.length) {
          failed++;
          console.log(`MISMATCH ${name} fps, speed ${speed}, cut ${start}-${end}: ${server.length}/${step.frames} frames, ${bad.length} differ (first at ${bad[0]}: server ${server[bad[0]]}, browser ${ours[bad[0]]})`);
        }
      }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (failed) { console.error(`frame schedule: ${failed} of ${checked} cases differ`); process.exit(1); }
  console.log(`frame-schedule-checks: ${checked} cases match ffmpeg frame for frame`);
})().catch((e) => { console.error(e); process.exit(1); });
