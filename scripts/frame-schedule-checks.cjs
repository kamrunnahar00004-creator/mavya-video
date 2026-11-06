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
  const { plan, stepArgs, countArgs, countFrames, pieceSoundArgs } = await import(path.join(root, "render/render.mjs"));
  const { fillSoundFile } = await import(path.join(root, "render/sound-file.mjs"));
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
    // Codex 2026-11-06: frames 0-28, then frame 59 alone (its own duration 1/30 s, 1 s after the one before it).
    "sparse VFR": make("sparse.mp4", ["-f", "lavfi", "-i", "nullsrc=s=32x32:r=30:d=2,geq=lum='16+N':cb=128:cr=128", "-vf", "select='lt(n,29)+eq(n,59)'", "-fps_mode", "vfr", ...enc]),
    "AAC priming": make("aac.mp4", [...ramp(30), "-f", "lavfi", "-i", "sine=duration=5", "-map", "0:v", "-map", "1:a", ...n(), ...enc, "-c:a", "aac"]),
  };
  const rate = { "30": 30, "60": 60, "29.97": 29.97, vfr: 30, "2 fps B-frames": 2, "picture after sound": 30, "AAC priming": 30, "sparse VFR": 0 };
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
    // Plus Codex 2026-11-06: a cut just past a frame (0-0.251) and a cut that runs to the file's end.
    const fileEnd = ref.pts[ref.pts.length - 1];
    const cuts = name === "2 fps B-frames" ? [[0, 0.9], [0.5, 3.2], [1.2, 5.6]] : name === "sparse VFR" ? [[0.5, 2], [0, 2], [0.9, 1.99], [0.2, 0.95]] : [[0.2, 1.4], [0.213, 1.377], [0, 0.9], [0.51, 1.02], [1.3, 1.95], [0, 0.251], [+(fileEnd - 1.075).toFixed(3), +(fileEnd + 0.5).toFixed(3)]];
    for (const speed of [0.5, 0.75, 0.9, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.5, 1.75, 2]) {
      for (const [start, end] of cuts) {
        const spec = { width: 32, height: 32, fps: 30, total: (end - start) / speed, segments: [{ gap: 0, speed, volume: 0, look: null, pieces: [{ start, end }] }], sounds: [], overlays: [] };
        const step = plan(spec)[0];
        const out = path.join(dir, "out.mkv");
        const counted = path.join(dir, "count.txt");
        run(countArgs(spec, step, { file }, counted));
        run(stepArgs(spec, step, { file, hasAudio: false }, out, countFrames(fs.readFileSync(counted, "utf8"))));
        const server = lumas(out);
        const pts = await frameTimes(packets, origin, start, end);
        const schedule = frameSchedule(pts, step, speed, 30), picks = schedule.source;
        const ours = picks.map((i) => {
          if (!(i >= 0 && i < pts.length)) return undefined;
          const k = ref.pts.findIndex((t) => Math.abs(t - pts[i]) < 0.002);
          return k < 0 ? undefined : ref.luma[k];
        });
        const bad = differ(server, ours, step.frames);
        checked++;
        // No frozen frame at the end of a cut (founder 2026-11-06: clips join like CapCut's magnet). At speed 1 or
        // faster, every output frame of a source at 30 fps or more is a new source frame while the file has frames left
        // (the browser's picks, which match the server frame for frame; a source's own repeated frames are not a hold).
        // Enough: the piece's frames after the first 30 fps pass cover its planned length (a cut running past the file's end
        // has fewer, and its repeats are spread over the piece, not held at the cut).
        const enough = Math.max(...schedule.slot) + 1 >= step.frames;
        const held = speed >= 1 && (rate[name] === 30 || rate[name] === 60) && name !== "vfr" && enough ? picks.findIndex((v, i) => i > 0 && v === picks[i - 1]) : -1;
        if (held >= 0) {
          failed++;
          console.log(`HELD FRAME ${name}, speed ${speed}, cut ${start}-${end}: output frame ${held} repeats frame ${held - 1} (${server.length} frames)`);
        }
        // Never a frame the user trimmed out: every shown frame starts before the cut's end.
        const past = picks.findIndex((i) => i >= 0 && pts[i] >= end - 1e-9);
        if (past >= 0) {
          failed++;
          console.log(`PAST END ${name}, speed ${speed}, cut ${start}-${end}: output frame ${past} shows ${pts[picks[past]].toFixed(4)} s`);
        }
        // No held last frame while the piece has frames enough for its length (the old setpts=PTS/speed did).
        const slots = schedule.slot, last = step.frames - 1;
        if (last > 0 && Math.max(...slots) + 1 >= step.frames && slots[last] === slots[last - 1]) {
          failed++;
          console.log(`END HOLD ${name}, speed ${speed}, cut ${start}-${end}`);
        }
        if (bad.length) {
          failed++;
          console.log(`MISMATCH ${name}, speed ${speed}, cut ${start}-${end}: ${server.length}/${step.frames} frames, ${bad.length} differ (first at ${bad[0]}: server ${server[bad[0]]}, browser ${ours[bad[0]]})`);
        }
      }
    }
    input.dispose();
  }
  // Sound (server piece): never sound from past the cut, and the piece's own sound fills its planned length.
  // Silent until 0.251 s, a constant 0.125 after it (Codex 2026-11-06 sentinel), and a 1 kHz sine.
  const pcm = (file) => { const b = execFileSync(ff, ["-v", "error", "-i", file, "-map", "0:a", "-f", "f32le", "-ac", "1", "-ar", "48000", "-"], { maxBuffer: 1e8 }); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
  const pic = ramp(30);
  const sentinel = make("sentinel.mkv", [...pic, "-f", "lavfi", "-i", "aevalsrc='if(lt(t,0.251),0,0.125)':s=48000:d=5", "-map", "0:v", "-map", "1:a", "-t", "5", ...enc, "-c:a", "pcm_f32le"]);
  const sine = make("sine.mkv", [...pic, "-f", "lavfi", "-i", "sine=f=1000:r=48000:d=5", "-map", "0:v", "-map", "1:a", "-t", "5", ...enc, "-c:a", "pcm_f32le"]);
  for (const [file, start, end, speed, want] of [[sentinel, 0, 0.251, 1.15, "silent"], [sentinel, 0, 0.251, 1, "silent"], [sine, 0.213, 1.377, 1.15, "full"], [sine, 0, 1, 1.15, "full"], [sine, 4, 5, 1.15, "full"], [sine, 0.2, 1.4, 0.5, "full"], [sine, 0.51, 1.02, 1, "full"], [sine, 0, 0.05, 0.5, "full"], [sine, 0, 0.06, 0.5, "full"], [sine, 0, 0.01, 1, "full"], [sine, 1.3, 1.95, 2, "full"]]) {
    const spec = { width: 32, height: 32, fps: 30, total: (end - start) / speed, segments: [{ gap: 0, speed, volume: 1, look: null, pieces: [{ start, end }] }], sounds: [], overlays: [] };
    const step = plan(spec)[0], out = path.join(dir, "aout.mkv"), counted = path.join(dir, "count.txt");
    run(countArgs(spec, step, { file }, counted));
    const raw = path.join(dir, "sound.raw"), fit = path.join(dir, "sound.fit.raw");
    run(pieceSoundArgs(step, { file }, raw));
    await fillSoundFile(raw, fit, Math.round(step.len * 48000));
    run(stepArgs(spec, step, { file, hasAudio: true }, out, countFrames(fs.readFileSync(counted, "utf8")), fit));
    const a = pcm(out), need = step.frames * 1600;
    let peak = 0, tail = 0, jump = 0;
    for (let i = 0; i < a.length; i++) { peak = Math.max(peak, Math.abs(a[i])); if (i) jump = Math.max(jump, Math.abs(a[i] - a[i - 1])); }
    while (tail < a.length && Math.abs(a[a.length - 1 - tail]) < 1e-3) tail++;
    const okLen = Math.abs(a.length - need) <= 2;
    // No click: no step between samples beyond the source sine's own largest (0.125 * 2 pi * 1000 / 48000) with margin.
    const maxStep = 0.125 * 2 * Math.PI * 1000 / 48000 * 1.6;
    const ok = want === "silent" ? peak < 1e-3 && okLen : okLen && tail <= 48 && jump <= maxStep;
    checked++;
    if (!ok) { failed++; console.log(`SOUND ${want} cut ${start}-${end} speed ${speed}: ${a.length}/${need} samples, peak ${peak.toFixed(4)}, silent tail ${(tail / 48).toFixed(2)} ms, largest step ${jump.toFixed(4)}`); }
  }
  // A piece with no frame at all (wholly past the file's end) is black for its whole length, never a shorter step.
  {
    const file = sources["30"], start = 5, end = 6;
    const spec = { width: 32, height: 32, fps: 30, total: 1, segments: [{ gap: 0, speed: 1, volume: 0, look: null, pieces: [{ start, end }] }], sounds: [], overlays: [] };
    const step = plan(spec)[0], counted = path.join(dir, "count.txt"), out = path.join(dir, "empty.mkv");
    run(countArgs(spec, step, { file }, counted));
    const slots = countFrames(fs.readFileSync(counted, "utf8"));
    run(stepArgs(spec, step, { file, hasAudio: false }, out, slots));
    const l = lumas(out);
    checked++;
    if (slots !== 0 || l.length !== step.frames || l.some((v) => v > 20)) { failed++; console.log(`EMPTY PIECE: count ${slots}, ${l.length}/${step.frames} frames, max luma ${Math.max(...l)}`); }
    // Codex 2026-11-06: 0.010-0.020 lies between two frames (count 0) but has sound: black, its sound kept.
    {
      const spec2 = { width: 32, height: 32, fps: 30, total: 0.05, segments: [{ gap: 0, speed: 1, volume: 1, look: null, pieces: [{ start: 0.01, end: 0.02 }] }], sounds: [], overlays: [] };
      const st2 = plan(spec2)[0], src2 = { file: sine, hasAudio: true }, out2 = path.join(dir, "between.mkv");
      run(countArgs(spec2, st2, src2, counted));
      const n2 = countFrames(fs.readFileSync(counted, "utf8"));
      const raw = path.join(dir, "sound.raw"), fit = path.join(dir, "sound.fit.raw");
      run(pieceSoundArgs(st2, src2, raw));
      await fillSoundFile(raw, fit, Math.round(st2.len * 48000));
      run(stepArgs(spec2, st2, src2, out2, n2, fit));
      const snd = pcm(out2), pics = lumas(out2);
      let peak = 0;
      for (const v of snd) peak = Math.max(peak, Math.abs(v));
      checked++;
      if (n2 !== 0 || pics.length !== st2.frames || Math.abs(snd.length - st2.frames * 1600) > 2 || peak < 0.05) { failed++; console.log(`BETWEEN FRAMES: count ${n2}, ${pics.length}/${st2.frames} frames, ${snd.length} samples, peak ${peak.toFixed(4)}`); }
    }
    let threw = 0;
    try { countFrames("garbage\n"); } catch { threw++; }
    try { stepArgs(spec, step, { file, hasAudio: false }, out); } catch { threw++; }
    checked++;
    if (threw !== 2) { failed++; console.log("COUNT VALIDATION: a bad count file or a missing count was accepted"); }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (failed) { console.error(`frame schedule: ${failed} of ${checked} cases differ`); process.exit(1); }
  console.log(`frame-schedule-checks: ${checked} cases match ffmpeg frame for frame`);
})().catch((e) => { console.error(e); process.exit(1); });

function assert(ok, message) { if (!ok) throw new Error(message); }
