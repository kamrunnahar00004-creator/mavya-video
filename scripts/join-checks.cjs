// Real exports, rendered by the server's own pipeline (render/server.mjs: plan, count, sound fill, stepArgs, concat,
// finalArgs), checked frame by frame (founder 2026-11-07: "0 gaps between clips, like CapCut's magnet" and "the
// subtitle matches its clip 100% of the time"). Each source has its own colour and its own tone, so every output
// frame and every stretch of sound says which clip it came from. For each timeline:
//  - the video has exactly the planned number of frames, one every 1/30 s, no timestamp gap;
//  - every frame shows the clip plan() puts there (no black or foreign frame at a join);
//  - each caption shows on exactly the frames textFrames() gives it, all inside its own clip;
//  - the sound runs the whole video with no silence at a join.
// Timelines include the cases the 2026-11-07 fuzz found (edges the editor and the export round differently).
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./check-module.cjs');
const root = path.join(__dirname, '..');
process.chdir(root);

const adjust = load('src/lib/adjust.ts');
const edit = load('src/lib/edit.ts', { '@/lib/adjust': adjust });
const ff = require(path.join(root, 'node_modules/ffmpeg-static'));
const FPS = 30, W = 32, H = 32;

(async () => {
  const { plan, planLength, layout, textFrames, countArgs, countFrames, pieceHasSound, pieceSoundArgs, stepArgs, finalArgs } = await import(path.join(root, 'render/render.mjs'));
  const { fillSoundFile } = await import(path.join(root, 'render/sound-file.mjs'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joins-'));
  const run = (args) => execFileSync(ff, ['-v', 'error', '-y', ...args.filter((a, k, all) => a !== '-progress' && all[k - 1] !== '-progress')], { maxBuffer: 1e8 });
  // Three sources: a luma ramp, a colour of their own (cb, cr) and a tone of their own.
  // Source 3 runs at 10 fps (Codex 2026-11-07: a cut between two of its frames showed black at the join).
  // Sources 4 and 5 run at 120 and 2 fps (Codex 2026-11-07, round 2: a 120 fps cut whose only frame lasts under half
  // an output frame, and a 2 fps cut far after its frame, both showed black).
  const COLOURS = [[60, 200], [200, 60], [100, 100], [160, 160], [90, 150], [150, 90]];
  const RATES = [30, 30, 30, 10, 120, 2];
  const sources = COLOURS.map(([cb, cr], i) => {
    const file = path.join(dir, `src${i}.mkv`);
    run(['-f', 'lavfi', '-i', `nullsrc=s=${W}x${H}:r=${RATES[i]}:d=6,geq=lum='40+N/2':cb=${cb}:cr=${cr}`, '-f', 'lavfi', '-i', `sine=f=${[440, 660, 880, 550, 330, 770][i]}:r=48000:d=6`, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-qp', '0', '-bf', '3', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_f32le', '-t', '6', file]);
    return { file, hasAudio: true, duration: 6 };
  });
  const caption = path.join(dir, 'caption.png');
  run(['-f', 'lavfi', '-i', 'color=white:s=8x8', '-frames:v', '1', caption]);

  const T = (start, end) => ({ id: 'p' + Math.random().toString(36).slice(2), start, end });
  const media = (n) => `00000000-0000-4000-8000-00000000000${n}.mp4`;
  // name, hook pieces + speed, clips (pieces, speed, gap, source)
  const CASES = [
    ['three clips, 1/30 s cuts, mixed speeds', [[T(0, 1.2)], 1], [[[T(0.2, 1.4)], 1.15, 0, 1], [[T(0.5, 1.9)], 0.75, 0, 2]]],
    ['editor edge 3.35 (fuzz)', [[T(0, 1.05)], 1], [[[T(0, 1.15), T(1, 2.15)], 1, 0, 1], [[T(0, 1)], 1.5, 0, 2]]],
    ['editor edge 3.6675 (fuzz)', [[T(0, 1.5), T(2, 3.6675 - 1.5 + 2 - 0.0005)], 1], [[[T(1.833, 1.867), T(0.033, 0.3)], 1.5, 0, 1], [[T(0, 1.2)], 1, 0, 2]]],
    ['sub-frame piece and 2x speed', [[T(0, 0.9)], 1], [[[T(0, 0.02), T(0.5, 1.7)], 2, 0, 1], [[T(1, 2.013)], 1, 0, 2]]],
    ['millisecond cuts', [[T(0.013, 1.377)], 1.25], [[[T(0.251, 1.019), T(2.003, 2.517)], 1, 0, 1], [[T(0.111, 0.999)], 0.9, 0, 2]]],
    ['cut between two frames of a 10 fps clip (Codex)', [[T(0, 1)], 1], [[[T(0.01, 0.06), T(0.3, 1.2)], 1, 0, 3], [[T(0, 1)], 1, 0, 1]]],
    ['120 fps cut with one short frame (Codex)', [[T(0, 1)], 1], [[[T(0.501, 0.511), T(1, 1.5)], 1, 0, 4], [[T(0, 1)], 1, 0, 1]]],
    ['2 fps cut long after its frame (Codex)', [[T(0, 1)], 1], [[[T(0.8, 0.95), T(1.5, 2.5)], 1, 0, 5], [[T(0, 1)], 1, 0, 2]]],
    ['space left with the magnet off', [[T(0, 1)], 1], [[[T(0, 1)], 1, 0.5, 1], [[T(0, 1)], 1, 0, 2]]],
  ];
  // Codex 2026-11-07 round 4: many one-frame pieces (20 clips of five 0.05 s pieces at 2x). Each piece file's length
  // is saved in whole milliseconds and the joins used to add those up: frames drifted onto the wrong clip.
  CASES.push(['many one-frame pieces (Codex)', [[T(0, 0.5)], 1], Array.from({ length: 20 }, (_, i) => [Array.from({ length: 5 }, (_, k) => T(0.1 * k, 0.1 * k + 0.05)), 2, 0, i % 3])]);
  let checked = 0, failed = 0;
  const fail = (name, msg) => { failed++; console.log(`${name}: ${msg}`); };
  for (const [name, [hookParts, hookSpeed], clipDefs] of CASES) {
    const span = (ps) => ({ start: Math.min(...ps.map((p) => p.start)), end: Math.max(...ps.map((p) => p.end)), parts: ps });
    const runDoc = {
      id: 'r', title: 't', texts: [],
      hook: { mode: 'upload', text: '', ...span(hookParts), adjust: { speed: hookSpeed }, generated: { src: '/api/media/' + media(0), seconds: 6 } },
      demo: { clip: null, frame: 'none', mode: 'clips', clips: clipDefs.map(([parts, speed, gap], i) => ({ id: `c${i}`, label: 'c', mediaId: media(i + 1), name: 'c', seconds: 6, ...span(parts), adjust: { speed }, gap: gap || undefined })) },
    };
    const segs = edit.timeline(runDoc, null);
    const srcOf = [0, ...clipDefs.map((c) => c[3])];
    // Captions as the editor saves them: one over each whole clip, contained.
    // One caption over each of up to four clips (the picture is 32 px wide): the first, the last and two between.
    const chosen = segs.length <= 4 ? segs.map((_, i) => i) : [0, Math.floor(segs.length / 3), Math.floor((2 * segs.length) / 3), segs.length - 1];
    const texts = edit.containTexts(chosen.map((i) => ({ id: `t${i}`, start: segs[i].offset, end: segs[i].offset + segs[i].len })), segs);
    const segments = segs.map((s, i) => ({ url: '', gap: s.gap, speed: edit.segSpeed(s), volume: 1, look: null, pieces: s.parts.map((p) => ({ start: p.start, end: p.end })), src: srcOf[i] }));
    // As /api/runs/[id]/export: the export's length is its planned frames (planLength), not the editor's sum.
    const total = planLength({ fps: FPS, segments });
    const spec = { width: W, height: H, fps: FPS, total, segments, sounds: [], overlays: texts.map((t, i) => ({ url: '', start: t.start, end: Math.min(total, t.end), owner: edit.textOwner(t.start, segs), x: 8 * i, y: 24 })) };
    // The server's pipeline.
    const steps = plan(spec), files = [];
    for (const [i, step] of steps.entries()) {
      const file = path.join(dir, `step${i}.mkv`), src = step.kind === 'piece' ? sources[spec.segments[step.si].src] : null;
      let slots, sound;
      if (src) {
        const counted = path.join(dir, `count${i}.txt`);
        run(countArgs(spec, step, src, counted));
        slots = countFrames(fs.readFileSync(counted, 'utf8'));
        if (pieceHasSound(spec, step, src)) {
          const raw = path.join(dir, `sound${i}.raw`);
          sound = path.join(dir, `sound${i}.fit.raw`);
          run(pieceSoundArgs(step, src, raw));
          await fillSoundFile(raw, sound, Math.round(step.len * 48000));
        }
      }
      run(stepArgs(spec, step, src, file, slots, sound));
      files.push(file);
    }
    const list = path.join(dir, 'list.txt');
    fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
    const out = path.join(dir, 'out.mp4');
    run(finalArgs(spec, list, { sounds: [], overlays: spec.overlays.map(() => caption) }, out));

    // Every frame: its time, and its pixels as yuv444 (W*H per plane).
    const info = spawnSync(ff, ['-v', 'info', '-i', out, '-map', '0:v', '-vf', 'showinfo,format=yuv444p', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], { maxBuffer: 1e8 });
    const pts = [...String(info.stderr).matchAll(/pts_time:([\d.-]+)/g)].map((m) => +m[1]);
    const size = W * H, frame = (k) => info.stdout.subarray(k * size * 3, (k + 1) * size * 3);
    const n = info.stdout.length / (size * 3);
    const where = layout(spec), planned = steps.reduce((t, s) => t + s.frames, 0);
    checked++;
    if (n !== planned || pts.length !== n) fail(name, `${n} frames (${pts.length} times), plan has ${planned}`);
    const badTime = pts.findIndex((t, k) => Math.abs(t - k / FPS) > 0.0005);
    checked++;
    if (badTime >= 0) fail(name, `frame ${badTime} at ${pts[badTime]} s, should be ${(badTime / FPS).toFixed(4)} s (a time gap)`);
    // Which clip each frame shows, by colour at (1,1); a space is black.
    const clipAt = (k) => {
      const f = frame(k), y = f[W + 1], cb = f[size + W + 1], cr = f[2 * size + W + 1];
      if (y < 24 && Math.abs(cb - 128) < 10 && Math.abs(cr - 128) < 10) return 'black';
      const i = COLOURS.findIndex(([b, r]) => Math.abs(cb - b) < 14 && Math.abs(cr - r) < 14);
      return i < 0 ? `unknown(${cb},${cr})` : i;
    };
    let wrong = null;
    where.segs.forEach((s, si) => {
      for (let k = s.gap.from; k < s.gap.to && !wrong; k++) if (clipAt(k) !== 'black') wrong = `frame ${k} should be the empty space, shows ${clipAt(k)}`;
      for (let k = s.clip.from; k < s.clip.to && !wrong; k++) if (clipAt(k) !== spec.segments[si].src) wrong = `frame ${k} should be clip ${si} (source ${spec.segments[si].src}), shows ${clipAt(k)}`;
    });
    // Black frames only where the user left space (magnet off): none at any join.
    const userSpace = where.segs.reduce((t, s, si) => t + (segs[si].gap > 0 ? s.gap.to - s.gap.from : 0), 0);
    let blacks = 0;
    for (let k = 0; k < n; k++) if (clipAt(k) === 'black') blacks++;
    if (!wrong && blacks !== userSpace) wrong = `${blacks} black frames, the user left ${userSpace}`;
    checked++;
    if (wrong) fail(name, wrong);
    // Captions: exactly textFrames()'s frames, inside the caption's own clip.
    let capBad = null;
    spec.overlays.forEach((o, i) => {
      const f = textFrames(spec, where, o), own = where.segs[chosen[i]].clip;
      if (f.from < own.from || f.to > own.to) capBad ??= `caption ${i} planned on frames ${f.from}-${f.to}, its clip ${own.from}-${own.to}`;
      if (f.from !== own.from || f.to !== own.to) capBad ??= `caption ${i} over its whole clip planned on ${f.from}-${f.to}, the clip is ${own.from}-${own.to}`;
      for (let k = 0; k < n && !capBad; k++) {
        const on = frame(k)[28 * W + 8 * i + 4] > 200;
        if (on !== (k >= f.from && k < f.to)) capBad = `caption ${i} ${on ? 'shows' : 'missing'} on frame ${k} (its frames ${f.from}-${f.to})`;
      }
    });
    checked++;
    if (capBad) fail(name, capBad);
    // Sound: as long as the video, and never silent inside it (longest near-silent run under 1 ms) unless the user left
    // space. Past the last frame is only the AAC encoder's padding to its 1024-sample block.
    const b = execFileSync(ff, ['-v', 'error', '-i', out, '-map', '0:a', '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], { maxBuffer: 1e8 });
    const a = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
    let run0 = 0, longest = 0, at = 0;
    // Only real space the user left is exempt (Codex 2026-11-07: an exemption around every join hid silence there).
    const gapSamples = where.segs.filter((s) => s.gap.to > s.gap.from).map((s) => [s.gap.from * 1600, s.gap.to * 1600]);
    for (let i = 0; i < Math.min(a.length, n * 1600); i++) {
      if (gapSamples.some(([x, y]) => i >= x - 2048 && i < y + 2048)) { run0 = 0; continue; }
      run0 = Math.abs(a[i]) < 1e-3 ? run0 + 1 : 0;
      if (run0 > longest) { longest = run0; at = i; }
    }
    checked++;
    if (Math.abs(a.length - n * 1600) > 1024) fail(name, `sound has ${a.length} samples, the video ${n * 1600}`);
    checked++;
    if (longest > 48) fail(name, `${(longest / 48).toFixed(1)} ms of silence ending at ${(at / 48000).toFixed(3)} s`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (failed) { console.error(`join-checks: ${failed} of ${checked} checks failed`); process.exit(1); }
  console.log(`join-checks: ${checked} checks pass (${CASES.length} real exports)`);
})().catch((e) => { console.error(e); process.exit(1); });
