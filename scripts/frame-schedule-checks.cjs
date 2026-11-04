// The browser export's frame choice against real ffmpeg running the server's own piece command (render.mjs
// stepArgs): every output frame must show the same source frame. The browser side runs as in the app: mediabunny
// reads the packets, mediaOrigin / frameTimes (render/frames.mjs) find the frame times, frameSchedule picks.
// Fixtures are lossless gray ramps (each frame its own luma): 30, 60, 29.97 fps, variable rate, 2 fps with deep
// B-frame reordering, a picture starting 0.3 s after its sound, and AAC priming.
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const root = path.join(__dirname, "..");
  const { plan, stepArgs } = await import(path.join(root, "render/render.mjs"));
  const { frameSchedule, frameTimes, mediaOrigin } = await import(path.join(root, "render/frames.mjs"));
  const { Input, BufferSource, ALL_FORMATS, EncodedPacketSink } = await import(path.join(root, "node_modules/mediabunny/dist/bundles/mediabunny.mjs"));
  const ff = require(path.join(root, "node_modules/ffmpeg-static"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frames-"));
  const run = (args) => execFileSync(ff, ["-v", "error", "-y", ...args]);
  const enc = ["-c:v", "libx264", "-qp", "0", "-bf", "3", "-pix_fmt", "yuv420p"];
  const ramp = (rate) => ["-f", "lavfi", "-i", `nullsrc=s=32x32:r=${rate},geq=lum='16+N':cb=128:cr=128`];
  const n = (count = 120) => ["-frames:v", String(count)];
  const make = (name, args) => { const file = path.join(dir, name); run([...args, file]); return file; };
  const sources = {
    "30": make("r30.mp4", [...ramp(30), ...n(), ...enc]),
    "60": make("r60.mp4", [...ramp(60), ...n(), ...enc]),
    "29.97": make("r2997.mp4", [...ramp("30000/1001"), ...n(), ...enc]),
    vfr: make("vfr.mp4", [...ramp(60), ...n(), "-vf", "select='if(lt(t,1),not(mod(n,2)),1)'", "-fps_mode", "vfr", ...enc]),
    "2 fps B-frames": make("low.mp4", [...ramp(2), ...n(12), "-c:v", "libx264", "-qp", "0", "-bf", "3", "-g", "30", "-x264-params", "b-adapt=0", "-pix_fmt", "yuv420p"]),
    "picture after sound": make("offset.mp4", ["-itsoffset", "0.3", ...ramp(30), "-f", "lavfi", "-i", "sine=duration=5", "-map", "0:v", "-map", "1:a", ...n(), ...enc, "-c:a", "aac"]),
    "AAC priming": make("aac.mp4", [...ramp(30), "-f", "lavfi", "-i", "sine=duration=5", "-map", "0:v", "-map", "1:a", ...n(), ...enc, "-c:a", "aac"]),
  };
  // Every frame's luma and time as ffmpeg's own timeline has them (start time subtracted, as stepArgs sees the file).
  const frames = (file) => {
    const info = spawnSync(ff, ["-v", "info", "-i", file, "-map", "0:v", "-vf", "showinfo,crop=2:2:0:0,extractplanes=y", "-fps_mode", "passthrough", "-f", "rawvideo", "-"], { maxBuffer: 1e8 });
    const luma = [...info.stdout].filter((_, i) => i % 4 === 0);
    return { luma, pts: [...String(info.stderr).matchAll(/pts_time:([\d.-]+)/g)].map((m) => +m[1]) };
  };
  const lumas = (file) => [...execFileSync(ff, ["-v", "error", "-i", file, "-vf", "crop=2:2:0:0,extractplanes=y", "-f", "rawvideo", "-"], { maxBuffer: 1e8 })].filter((_, i) => i % 4 === 0);
  // The comparison must fail on a missing or wrong frame (2026-11-04 Codex F11: NaN compared as a match).
  const differ = (server, ours, n) => {
    if (server.length !== n || ours.length !== n) return [-1];
    return server.map((v, i) => (!Number.isFinite(ours[i]) || v !== ours[i] ? i : -1)).filter((i) => i >= 0);
  };
  assert(differ([5, 6], [5, undefined], 2).length === 1 && differ([5, 6], [5, 7], 2).length === 1 && differ([5], [5], 2).length === 1, "the comparison itself must catch missing and wrong frames");

  let checked = 0, failed = 0;
  for (const [name, file] of Object.entries(sources)) {
    const ref = frames(file);
    const input = new Input({ source: new BufferSource(fs.readFileSync(file)), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const origin = await mediaOrigin(input);
    const packets = new EncodedPacketSink(track);
    const cuts = name === "2 fps B-frames" ? [[0, 0.9], [0.5, 3.2], [1.2, 5.6]] : [[0.2, 1.4], [0.213, 1.377], [0, 0.9], [0.51, 1.02], [1.3, 1.95]];
    for (const speed of [0.5, 0.75, 0.9, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.5, 1.75, 2]) {
      for (const [start, end] of cuts) {
        const spec = { width: 32, height: 32, fps: 30, total: (end - start) / speed, segments: [{ gap: 0, speed, volume: 0, look: null, pieces: [{ start, end }] }], sounds: [], overlays: [] };
        const step = plan(spec)[0];
        const out = path.join(dir, "out.mkv");
        run(stepArgs(spec, step, { file, hasAudio: false }, out));
        const server = lumas(out);
        const pts = await frameTimes(packets, origin, start, end);
        const ours = frameSchedule(pts, step, speed, 30).source.map((i) => {
          if (!(i >= 0 && i < pts.length)) return undefined;
          const k = ref.pts.findIndex((t) => Math.abs(t - pts[i]) < 0.002);
          return k < 0 ? undefined : ref.luma[k];
        });
        const bad = differ(server, ours, step.frames);
        checked++;
        if (bad.length) {
          failed++;
          console.log(`MISMATCH ${name}, speed ${speed}, cut ${start}-${end}: ${server.length}/${step.frames} frames, ${bad.length} differ (first at ${bad[0]}: server ${server[bad[0]]}, browser ${ours[bad[0]]})`);
        }
      }
    }
    input.dispose();
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (failed) { console.error(`frame schedule: ${failed} of ${checked} cases differ`); process.exit(1); }
  console.log(`frame-schedule-checks: ${checked} cases match ffmpeg frame for frame`);
})().catch((e) => { console.error(e); process.exit(1); });

function assert(ok, message) { if (!ok) throw new Error(message); }
