// Lists never decode videos (founder 2026-11-09: My files was slow and the screen went black for seconds). Every My
// files card was a <video> of the ORIGINAL upload (4K HDR phone clips); an HDR video can switch a Windows screen's
// display mode. Now lists show a small JPEG made once on the server; a click plays. My files' code and list load on
// hover. Checks the picture's ffmpeg arguments on real files (an HDR clip too) and the wiring. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 31;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const ff = require('ffmpeg-static');

finish('list-speed-checks', EXPECTED, () => checks, async () => {
  const { thumbOf } = load('src/lib/thumb.ts');
  ok(thumbOf('/api/media/abc-1.mp4#t=0.5') === '/api/media/abc-1.mp4/thumb' && thumbOf('/api/media/a.mov?preview=1') === '/api/media/a.mov/thumb', 'a stored video\'s picture link');
  ok(thumbOf('https://x.com/a.mp4') === null && thumbOf('/api/sounds/abc') === null, 'no picture link for anything else');

  const render = await import(path.resolve('render/render.mjs'));
  const thumbs = load('src/lib/server/thumbs.ts', {
    '@/lib/server/ffmpeg': {}, '@/lib/server/r2': {}, '@/lib/server/previews': {}, '@/lib/server/store': {},
    '../../../render/render.mjs': render,
    'node:child_process': require('node:child_process'), 'node:fs': fs, 'node:stream': require('node:stream'), 'node:stream/promises': require('node:stream/promises'), 'node:fs/promises': require('node:fs/promises'), 'node:os': os, 'node:path': path, 'node:util': require('node:util'),
  });
  ok(thumbs.thumbKey('abc-1.mov') === 'media/abc-1.t320.jpg', 'kept next to its file');
  // Real files: an SDR clip and an HDR (HLG) clip, 4K-tall like a phone's.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-'));
  const sdr = path.join(dir, 'sdr.mp4'), hdr = path.join(dir, 'hdr.mp4');
  execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:d=1.5:r=30', '-pix_fmt', 'yuv420p', sdr]);
  execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:d=1.5:r=30', '-pix_fmt', 'yuv420p10le', '-c:v', 'libx265', '-x265-params', 'log-level=none', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', hdr]);
  const probe = (f) => { try { execFileSync(ff, ['-hide_banner', '-i', f], { stdio: 'pipe' }); return ''; } catch (e) { return String(e.stderr); } };
  const size = (f) => /(\d+)x(\d+)/.exec(probe(f).split('\n').find((l) => / Video: /.test(l)) ?? '')?.slice(1).map(Number);
  ok(!render.isHdr(probe(sdr)) && render.isHdr(probe(hdr)), 'an HDR clip is told apart');
  const a = path.join(dir, 'a.jpg'), b = path.join(dir, 'b.jpg');
  execFileSync(ff, thumbs.thumbArgs(sdr, a, 0.5, false), { stdio: 'pipe' });
  const [w, h] = size(a);
  ok(w === 320 && h === 568 && fs.statSync(a).size < 60_000, `one small picture (${w}x${h}, ${fs.statSync(a).size} B)`);
  execFileSync(ff, thumbs.thumbArgs(hdr, b, 0.5, true), { stdio: 'pipe' });
  ok(size(b)[0] === 320 && fs.statSync(b).size > 1000, 'an HDR clip gives a tone-mapped picture');
  // Codex 2026-11-09: a clip shorter than 0.5 s has no frame there; its first frame is used.
  const short = path.join(dir, 'short.mp4'), c = path.join(dir, 'c.jpg');
  execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:d=0.3:r=30', '-pix_fmt', 'yuv420p', short]);
  try { execFileSync(ff, thumbs.thumbArgs(short, c, 0.5, false), { stdio: 'pipe' }); } catch { /* no frame */ }
  const none = !fs.existsSync(c) || fs.statSync(c).size === 0;
  execFileSync(ff, thumbs.thumbArgs(short, c, 0, false), { stdio: 'pipe' });
  ok(none && fs.statSync(c).size > 1000, 'a 0.3 s clip: nothing at 0.5 s, a picture from its first frame');
  ok(thumbs.thumbArgs('i', 'o', 0, false).filter((x) => x === '-threads').length === 2, 'ffmpeg on one thread');
  fs.rmSync(dir, { recursive: true, force: true });

  const src = (f) => fs.readFileSync(f, 'utf8');
  const lib = src('src/lib/server/thumbs.ts');
  ok(/await pipeline\(Readable\.fromWeb\(res\.body/.test(lib) && /createWriteStream\(input\)/.test(lib) && /thumbArgs\(input, out/.test(lib) && !/thumbArgs\(url/.test(lib) && !/arrayBuffer/.test(lib), 'ffmpeg reads a file streamed to disk (never an https link: the static build crashes on those; never whole in memory)');
  ok(/const AT_ONCE = 2;/.test(lib) && /job = \(async \(\) => \{ if \(!\(await objectInfo\(key\)\)\) await slot\(async \(\) =>/.test(lib), 'at most two pictures made at once per server; one already made is found at once');
  ok(/if \(!\(await stat\(out\)\.catch\(\(\) => null\)\)\?\.size\) await make\(0\);/.test(lib) && /await frameFrom\(input, out, at, !fromPreview\);/.test(lib) && /await frameFrom\(file, temp, 0\.5, true\);/.test(lib), 'the first-frame fallback and HDR tone-mapping, cloud and local');
  ok(/export async function localThumb[\s\S]{0,300}job = slot\(async/.test(lib), 'local pictures share the limit');
  ok(/size > MAX_BYTES[\s\S]{0,300}requestPreview\(id\)/.test(lib), 'a too-big original asks for its light copy');
  ok(/const fromPreview = await previewReady\(id\);/.test(lib), 'made from the light copy when there is one');
  const route = src('src/app/api/media/[id]/thumb/route.ts');
  ok(/mediaAccess\(id, who\)/.test(route) && /signInFirst\(\)/.test(route), 'only the owner gets the picture');
  ok(/max-age=82800, immutable/.test(route), 'the browser keeps it');
  ok(/oldMasterKey\(id\)\]\), \.\.\.d\.media_ids\.map\(thumbKey\)\];/.test(src('src/lib/server/account-deletion.ts')), 'deleting the account deletes the pictures, added after the existing keys (a deletion under way keeps its place)');
  const cfg = src('next.config.ts');
  ok(/"\/api\/media\/\*\/thumb": \["\.\/node_modules\/ffmpeg-static\/ffmpeg"\]/.test(cfg) && /"\/api\/uploads": \["\.\/node_modules\/ffmpeg-static\/ffmpeg"\]/.test(cfg), 'ffmpeg ships with the routes that make pictures');
  ok(/thumbLink\(done\.mediaId\)/.test(src('src/app/api/uploads/route.ts')), 'an upload gets its picture right away');

  // No list decodes a video: one picture component, retried when not made yet (Codex 2026-11-09), used by every list.
  const img = src('src/components/thumb-img.tsx');
  ok(/const thumb = thumbOf\(src\);/.test(img) && /<img key=\{`\$\{src\}\|\$\{tries\}`\} src=\{tries \? `\$\{thumb\}\?try=\$\{tries\}` : thumb\}/.test(img) && !/<video/.test(img), 'the list picture: an image of the stored picture');
  ok(/setTimeout\(\(\) => setState\(\{ src, tries: tries \+ 1 \}\), tries \? 20_000 : 5_000\)/.test(img) && /onError=\{retry\}/.test(img), 'a picture not ready yet is tried again');
  ok(/const tries = state\.src === src \? state\.tries : 0;/.test(img) && /useEffect\(\(\) => \(\) => \{ if \(timer\.current\) clearTimeout\(timer\.current\);/.test(img), 'a new clip starts afresh; an old retry is dropped (Codex 2026-11-09)');
  const panel = src('src/components/history-panel.tsx');
  ok(!/MediaVideo/.test(panel) && /function Still[\s\S]{0,200}<ThumbImg src=\{src\}/.test(panel), 'My files cards: pictures, not videos');
  ok((panel.match(/^\s*<video$/gm) ?? []).length === 1 && /function PlayPopup/.test(panel), 'only the popup (after a click) plays a video');
  ok(/src: `\$\{src\}\?preview=1`/.test(panel), 'an upload plays its light copy');
  ok(!/MediaVideo/.test(src('src/components/runs-list.tsx')) && /<ThumbImg src=\{src\}/.test(src('src/components/runs-list.tsx')), 'the video list: pictures');
  ok(/if \(r\.mediaId\) return <ThumbImg src=\{`\/api\/media\/\$\{r\.mediaId\}`\}/.test(src('src/components/source-picker.tsx')), 'uploaded hooks: pictures');
  const view = src('src/components/run-view.tsx');
  ok(/<ThumbImg src=\{still\}/.test(view), 'faces made before: pictures');
  ok(/const file = localMediaPath\(id\);[\s\S]{0,200}localThumb\(file\)/.test(route), 'local storage makes pictures too');
  // Opens at once: code and list start loading on hover; the last list shows at once and refreshes.
  ok(/onPointerEnter=\{warmFiles\} onFocus=\{warmFiles\}/.test(view) && /const warmFiles = \(\) => \{ void loadHistoryPanel\(\); void loadFiles\(\)/.test(view), 'hovering My files loads its code and list');
  ok(/useState<FileSources \| null>\(peekFiles\)/.test(panel) && /const fresh = opened\.current \? true : Boolean\(peekFiles\(\)\);\n    opened\.current = true;\n    loadFiles\(fresh\)/.test(panel), 'the last list shows at once, then refreshes');
});
