// Measures the exports made by export-colour-run.mjs against their source (scripts/browser/export-colour.sh):
// standard range (black near Y 16, white near Y 235), BT.709 standard-range labels in the file, and each colour
// patch within 4 levels of the source's. Exits non-zero on any failure.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ff = require('ffmpeg-static');
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => /^out-.*\.mp4$/.test(f));
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL', msg); } };
// Frame 15's raw planes (bytes as stored) and, read as standard-range BT.709, its RGB.
// No pixel format asked: ffmpeg hands over the decoder's own bytes (yuv420p or yuvj420p, the same layout), never a
// range conversion (Codex 2026-11-10: asking for yuv420p turned full-range bytes into 16-235).
const raw = (f) => execFileSync(ff, ['-v', 'error', '-i', f, '-vf', 'select=eq(n\\,15)', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 26 });
const rgb = (f) => execFileSync(ff, ['-v', 'error', '-i', f, '-vf', 'select=eq(n\\,15),setparams=range=tv:colorspace=bt709:color_trc=bt709:color_primaries=bt709,scale=in_range=tv:in_color_matrix=bt709:out_range=full,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 26 });
const W = 1080, PATCHES = ['black', 'white', 'dark', 'light', 'red', 'green', 'blue', 'skin'];
const centre = (i) => [i % 2 ? 810 : 270, Math.floor(i / 2) * 480 + 240];
const meanRgb = (buf, i) => { const [cx, cy] = centre(i); const s = [0, 0, 0]; let n = 0; for (let y = cy - 60; y < cy + 60; y++) for (let x = cx - 60; x < cx + 60; x++) { for (let k = 0; k < 3; k++) s[k] += buf[(y * W + x) * 3 + k]; n++; } return s.map((v) => v / n); };
const meanY = (buf, i) => { const [cx, cy] = centre(i); let s = 0, n = 0; for (let y = cy - 60; y < cy + 60; y++) for (let x = cx - 60; x < cx + 60; x++) { s += buf[y * W + x]; n++; } return s / n; };
const src = path.join(dir, 'source.mp4');
const srcRgb = rgb(src);
ok(files.length > 0, 'at least one export to measure');
for (const f of files) {
  const file = path.join(dir, f);
  const info = (() => { try { execFileSync(ff, ['-hide_banner', '-i', file], { stdio: 'pipe' }); return ''; } catch (e) { return String(e.stderr); } })();
  // trace_headers writes to stderr, also when ffmpeg succeeds.
  const vui = String(spawnSync(ff, ['-hide_banner', '-i', file, '-c', 'copy', '-bsf:v', 'trace_headers', '-frames:v', '1', '-f', 'null', '-']).stderr);
  ok(/seq_parameter_set_id/.test(vui), `${f}: the stream's headers were read`);
  const outRaw = raw(file), outRgb = rgb(file);
  ok(outRaw.length === W * 1920 * 1.5, `${f}: raw frame is 8-bit 4:2:0 as stored (${outRaw.length} bytes)`);
  const yb = meanY(outRaw, 0), yw = meanY(outRaw, 1);
  if (process.env.PATCHES === 'no') {
    const ys = [...outRaw.subarray(0, W * 1920)].sort((x, y) => x - y), lo = ys[Math.floor(ys.length * 0.001)], hi = ys[Math.floor(ys.length * 0.999)];
    ok(/yuv420p\(tv, bt709/.test(info), `${f}: file says standard range BT.709 (${/yuvj?420p\([^)]*\)/.exec(info)?.[0]})`);
    ok(lo >= 12 && hi <= 240, `${f}: stored as standard range (Y 0.1%-99.9% ${lo}-${hi})`);
    ok(!/video_full_range_flag\s+1 = 1/.test(vui), `${f}: the H.264 stream never says full range`);
    console.log(`${f}: Y ${lo}-${hi}, ${/yuvj?420p\([^)]*\)/.exec(info)?.[0]}`);
    continue;
  }
  ok(/yuv420p\(tv, bt709/.test(info), `${f}: file says standard range BT.709 (${/yuvj?420p\([^)]*\)/.exec(info)?.[0]})`);
  ok(Math.abs(yb - 16) <= 3 && Math.abs(yw - 235) <= 3, `${f}: stored as standard range (black Y ${yb.toFixed(1)}, white Y ${yw.toFixed(1)}; want 16 and 235)`);
  const full = /video_full_range_flag\s+1 = 1/.test(vui);
  ok(!full, `${f}: the H.264 stream never says full range`);
  let worst = 0;
  PATCHES.forEach((name, i) => {
    const a = meanRgb(srcRgb, i), b = meanRgb(outRgb, i);
    const d = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
    worst = Math.max(worst, d);
    ok(d <= 4, `${f}: ${name} matches the source (source ${a.map((v) => v.toFixed(0))}, export ${b.map((v) => v.toFixed(0))})`);
  });
  console.log(`${f}: black Y ${yb.toFixed(1)}, white Y ${yw.toFixed(1)}, worst colour difference ${worst.toFixed(1)} levels, stream VUI ${/vui_parameters_present_flag\s+1 = 1/.test(vui) ? 'present' : 'absent'}`);
}
console.log(fails ? `export-colour: ${fails} of ${checks} checks FAILED` : `export-colour: ${checks} checks pass (${files.length} encoder settings)`);
process.exit(fails ? 1 : 0);
