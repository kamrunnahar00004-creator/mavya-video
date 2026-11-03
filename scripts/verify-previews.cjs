// Preview copies: which players ask for them, the key they live at, and the real ffmpeg recipe the render server runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, stubs = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require(id) {
    if (id === 'server-only') return {};
    if (Object.hasOwn(stubs, id)) return stubs[id];
    throw new Error(`Unstubbed import: ${id}`);
  }, process: { env: {} }, Date, Map, console }, { filename: file });
  return module.exports;
}

const { previewOf } = load('src/lib/media-preview.ts');
const id = '22559cbe-10ca-45c9-8458-9a9cdd1e62ce';
assert.equal(previewOf(`/api/media/${id}.mp4`), `/api/media/${id}.mp4?preview=1`);
assert.equal(previewOf(`/api/media/${id}.mov#t=0.5`), `/api/media/${id}.mov?preview=1#t=0.5`, 'keeps the frame hint');
assert.equal(previewOf('/api/sounds/abc'), '/api/sounds/abc', 'only stored media');
assert.equal(previewOf('blob:http://x/1'), 'blob:http://x/1', 'files still uploading play from the computer');
assert.equal(previewOf(undefined), undefined);

const { previewKey } = load('src/lib/server/previews.ts', { '@/lib/server/r2': {} });
assert.equal(previewKey(`${id}.mov`), `media/${id}.p480.mp4`);

// The hook never uses a copy; uploads and the phone preview's demo clips do.
const preview = fs.readFileSync(path.join(root, 'src/components/run-preview.tsx'), 'utf8');
assert.match(preview, /src=\{s\.id === "hook" \? s\.src! : previewOf\(s\.src!\)\}/);
const deletion = fs.readFileSync(path.join(root, 'src/lib/server/account-deletion.ts'), 'utf8');
assert.match(deletion, /d\.media_ids\.flatMap\(id => \[previewKey\(id\), oldPreviewKey\(id\), masterKey\(id\)\]\)\]/, 'account deletion removes copies');

// Real ffmpeg: a 4K 60 fps landscape recording and a portrait one come out short side 480, at most 30 fps.
(async () => {
  const { previewArgs, plan, stepArgs } = await import(path.join(root, 'render/render.mjs'));
  // Export: each piece of a Cut clip renders with its own look and sound when it has them.
  {
    const spec = { width: 720, height: 1280, fps: 30, total: 4, segments: [{ gap: 0, speed: 1, volume: 1, look: null, pieces: [{ start: 0, end: 2 }, { start: 2, end: 4, volume: 0.5, look: { brightness: 20 } }] }], sounds: [], overlays: [] };
    const steps = plan(spec);
    const graph = (s) => stepArgs(spec, s, { file: 'x.mp4', hasAudio: true }, 'o.mkv').join(' ');
    assert.ok(!graph(steps[0]).includes('lutrgb') && graph(steps[0]).includes('volume=1'), 'first piece: the clip\'s look');
    assert.ok(graph(steps[1]).includes('lutrgb') && graph(steps[1]).includes('volume=0.5'), 'second piece: its own look and volume');
  }
  const ff = require('ffmpeg-static');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mavya-preview-'));
  try {
    const cases = [
      ['landscape', ['-f', 'lavfi', '-i', 'testsrc2=s=3840x2160:r=60:d=2.2', '-f', 'lavfi', '-i', 'sine=d=2.2'], '854x480'],
      ['portrait', ['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=2.2'], '480x854'],
    ];
    for (const [name, input, want] of cases) {
      const src = path.join(dir, `${name}.mp4`), out = path.join(dir, `${name}-preview.mp4`);
      execFileSync(ff, ['-v', 'error', '-y', ...input, '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest', src]);
      execFileSync(ff, ['-v', 'error', ...previewArgs(src, out)]);
      let info = '';
      try { execFileSync(ff, ['-hide_banner', '-i', out], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { info = String(e.stderr); }
      const size = /Video: .*?(\d{3,4})x(\d{3,4})/.exec(info);
      const shown = size ? `${size[1]}x${size[2]}` : '?';
      assert.equal(shown, want, name);
      assert.match(info, /(\d+(?:\.\d+)?) fps/);
      assert.ok(Number(/(\d+(?:\.\d+)?) fps/.exec(info)[1]) <= 30, `${name}: at most 30 fps`);
      // Same pass with the export's working copy: short side 1080 next to the 480p preview.
      const master = path.join(dir, `${name}-master.mp4`), out2 = path.join(dir, `${name}-p2.mp4`);
      execFileSync(ff, ['-v', 'error', ...previewArgs(src, out2, master)]);
      for (const [file, size] of [[out2, want], [master, want.replace('854', '1920').replace('480', '1080')]]) {
        let info2 = '';
        try { execFileSync(ff, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { info2 = String(e.stderr); }
        const d = /Video: .*?(\d{3,4})x(\d{3,4})/.exec(info2);
        assert.equal(d ? `${d[1]}x${d[2]}` : '?', size, `${name}: ${path.basename(file)}`);
      }
    }
    console.log('PASS: preview copies (short side 480, at most 30 fps), keys, players and deletion');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
