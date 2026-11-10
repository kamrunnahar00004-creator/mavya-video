// Browser exports are standard-range BT.709, like CapCut, phones and our server (founder 2026-11-10: exports looked too
// contrasty and saturated in Windows Media Player). They were full range (Y 0-255, colour box full-range bit set, no
// colour description in the stream); a player that ignores the flag crushes darks and adds ~11% saturation. Now each
// frame is converted on the GPU to standard-range I420 and handed to the encoder as it is. Offline: the shader's
// numbers against ffmpeg's own BT.709 conversion, the colour box rewrite, and the wiring. The real-Chrome check is
// scripts/browser/export-colour.sh (every encoder setting, measured with ffmpeg).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 14;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const ff = require('ffmpeg-static');

finish('export-colour-checks', EXPECTED, () => checks, () => {
  const src = fs.readFileSync('src/lib/browser-export.ts', 'utf8');
  class Quality { constructor(o) { Object.assign(this, o); } }
  const m = load('src/lib/browser-export.ts', {
    mediabunny: { Quality }, '../../render/render.mjs': {}, '../../render/frames.mjs': {}, '../../render/sound.mjs': {},
  }, {}, { navigator: {}, Uint8Array });

  // The colour box: BT.709 primaries, curve and matrix; standard range; the box's other bits kept.
  const box = (flags) => Uint8Array.from([0, 0, 0, 19, ...Buffer.from('colrnclx'), 0, 1, 0, 13, 0, 1, flags, 9, 9]);
  const a = m.bt709(box(0x80 | 0x05));
  ok(Buffer.from(a.subarray(12, 18)).equals(Buffer.from([0, 1, 0, 1, 0, 1])), 'colour box says BT.709 (primaries, curve, matrix)');
  ok(a[18] === 0x05, 'the full-range bit is cleared and nothing else in that byte changes');
  ok(Buffer.from(a.subarray(19)).equals(Buffer.from([9, 9])), 'bytes after the box untouched');
  const none = Uint8Array.from(Buffer.from('no colour box here at all'));
  ok(Buffer.from(m.bt709(none.slice())).equals(Buffer.from(none)), 'a file without a colour box is left as it is');
  ok(m.BT709_LIMITED.fullRange === false && m.BT709_LIMITED.matrix === 'bt709' && m.BT709_LIMITED.primaries === 'bt709' && m.BT709_LIMITED.transfer === 'bt709', 'frames are labelled standard-range BT.709');

  // The shader's numbers, read from the shader itself, against ffmpeg converting the same colours.
  const fs1 = /const YUV_FS = `([\s\S]*?)`;/.exec(src)[1];
  const K = /const vec3 K = vec3\(([\d.]+), ([\d.]+), ([\d.]+)\);/.exec(fs1).slice(1).map(Number);
  const yOff = /return (\d+\.\d+) \+ (\d+\.\d+) \* dot\(px/.exec(fs1).slice(1).map(Number);
  const c = /v == 0 \? (\d+\.\d+) \+ (\d+\.\d+) \* \(m\.b - y\) \/ ([\d.]+) : (\d+\.\d+) \+ (\d+\.\d+) \* \(m\.r - y\) \/ ([\d.]+);/.exec(fs1).slice(1).map(Number);
  const shade = ([r, g, b]) => { const [R, G, B] = [r, g, b].map((x) => x / 255); const y = K[0] * R + K[1] * G + K[2] * B; return [yOff[0] + yOff[1] * y, c[0] + c[1] * (B - y) / c[2], c[3] + c[4] * (R - y) / c[5]].map((v) => Math.floor(Math.min(255, Math.max(0, v)) + 0.5)); };
  const colours = [[0, 0, 0], [255, 255, 255], [128, 128, 128], [200, 30, 30], [30, 180, 60], [40, 60, 200], [225, 170, 140], [255, 0, 0], [0, 0, 255]];
  // Each colour as a 16x16 block (its centre's chroma is that colour alone), converted by ffmpeg.
  const B = 16, pic = Buffer.alloc(B * B * colours.length * 3);
  colours.forEach((col, i) => { for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) pic.set(col, ((i * B + y) * B + x) * 3); });
  const out = execFileSync(ff, ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${B}x${B * colours.length}`, '-i', 'pipe:0', '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', 'pipe:1'], { input: pic });
  const Ysz = B * B * colours.length, Csz = Ysz / 4;
  let worst = 0;
  colours.forEach((col, i) => {
    const cy = i * B + B / 2, cc = (i * B) / 2 + B / 4;
    const want = [out[cy * B + B / 2], out[Ysz + cc * (B / 2) + B / 4], out[Ysz + Csz + cc * (B / 2) + B / 4]];
    const got = shade(col);
    worst = Math.max(worst, ...want.map((v, k) => Math.abs(v - got[k])));
  });
  ok(worst <= 1, `shader matches ffmpeg's standard-range BT.709 within 1 level (worst ${worst})`);
  ok(shade([0, 0, 0])[0] === 16 && shade([255, 255, 255])[0] === 235 && shade([128, 128, 128]).slice(1).every((v) => v === 128), 'black 16, white 235, grey has no colour');

  // Wiring.
  ok(/new VideoSampleSource\(\{/.test(src) && !/CanvasSource/.test(src), 'the encoder gets our frames, never the canvas (no encoder-chosen conversion)');
  ok(/new VideoSample\(yuv\.read\(prog\), \{ format: "I420", codedWidth: W, codedHeight: H, timestamp: n \/ fps, duration: 1 \/ fps, colorSpace: BT709_LIMITED \}\)/.test(src) && /finally \{ frame\.close\(\); \}/.test(src), 'every frame: standard-range I420, closed after encoding');
  ok(/const source = tex\(W, H, gl\.RGB8\)/.test(src), 'the canvas copy is RGB (the canvas has no alpha; an RGBA copy fails and encodes black)');
  ok(/if \(gl\.getError\(\) !== gl\.NO_ERROR\) throw new Error\("webgl yuv"\);/.test(src), 'a failed conversion stops the export instead of encoding black');
  ok(/const file = bt709\(new Uint8Array\(buffer\)\);/.test(src) && /new Blob\(\[bt709\(new Uint8Array\(out\)\)\]/.test(src), 'the video and its demo part both get the colour box');
  ok(/if \(W % 8 \|\| H % 2\) throw new Error\("frame size"\);/.test(src), 'frame sizes the packing cannot hold are refused');
  ok(/gl\.bindAttribLocation\(prog, 0, "p"\);[\s\S]*gl\.bindAttribLocation\(prog, 0, "p"\);/.test(src) && /gl\.vertexAttribPointer\(0, 2/.test(src), 'both passes draw with the same vertex buffer');
});
