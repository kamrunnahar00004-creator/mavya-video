// Export upload (founder 2026-11-15: "export is stuck"): one upload connection hung and each try was allowed the
// whole 13 minutes. Now each try is dropped after 20 s without progress and the next starts at once; slow but moving
// uploads are left alone; the demo can't hold up the video. Simulated connections and clock. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 26;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const up = load('src/lib/upload-put.ts', {}, {}, { setInterval, clearInterval, Blob });

/** A pretend network: each connection follows a script ('ok', 'hang', 'error', 500, or a function). */
function net(scripts) {
  const w = { clock: 0, ticks: new Set(), made: [], progress: [] };
  w.now = () => w.clock;
  w.every = (fn) => { const t = { fn }; w.ticks.add(t); return t; };
  w.stop = (t) => w.ticks.delete(t);
  w.advance = async (ms) => { for (let i = 0; i < ms / 1000; i++) { w.clock += 1000; for (const t of [...w.ticks]) t.fn(); await new Promise((r) => setImmediate(r)); } };
  w.makeXhr = () => {
    const plan = scripts[w.made.length] ?? 'ok';
    const x = { status: 0, upload: { onprogress: null }, onload: null, onerror: null, onabort: null, aborted: false, headers: {},
      open(m, u) { x.method = m; x.url = u; }, setRequestHeader(k, v) { x.headers[k] = v; },
      abort() { x.aborted = true; setImmediate(() => x.onabort?.()); },
      send() { setImmediate(() => { if (plan === 'ok') { x.upload.onprogress?.({ loaded: 50, total: 100 }); x.upload.onprogress?.({ loaded: 100, total: 100 }); x.status = 200; x.onload(); } else if (plan === 'error') x.onerror(); else if (typeof plan === 'number') { x.status = plan; x.onload(); } else if (typeof plan === 'function') plan(x, w); }); } };
    w.made.push(x);
    return x;
  };
  w.opts = (extra = {}) => ({ contentType: 'video/mp4', deadline: 13 * 60e3, makeXhr: w.makeXhr, now: w.now, every: w.every, stop: w.stop, onProgress: (f) => w.progress.push(f), ...extra });
  return w;
}
const body = new Blob(['x']);
/** Runs the upload while moving the pretend clock forward. */
async function run(w, extra, seconds = 120) {
  let done = null;
  const p = up.putWithStallGuard('https://r2/put', body, w.opts(extra)).then((r) => { done = r; });
  for (let i = 0; i < seconds && done === null; i++) await w.advance(1000);
  await p;
  return done;
}

finish('upload-put-checks', EXPECTED, () => checks, async () => {
  let w = net(['ok']);
  ok((await run(w)) === true && w.made.length === 1, 'a normal upload: one try, done');
  ok(w.made[0].method === 'PUT' && w.made[0].headers['content-type'] === 'video/mp4', 'PUT with the link\'s content type');
  ok(w.progress.at(-1) === 1, 'the button is told how much is sent');

  // The bug: a connection that hangs with no progress.
  w = net(['hang', 'ok']);
  const t0 = w.clock;
  ok((await run(w)) === true && w.made.length === 2, 'a hung try is dropped and the next one succeeds');
  ok(w.made[0].aborted && w.clock - t0 <= 50e3, 'a try that never starts sending is dropped after about 45 s, not 13 minutes');
  w = net([(x) => { x.upload.onprogress({ loaded: 10, total: 100 }); }, 'ok']);
  const tm = w.clock;
  ok((await run(w)) === true && w.made[0].aborted && w.clock - tm <= 25e3, 'an upload that stops halfway is dropped after about 20 s and retried');

  // Slow but moving: never dropped.
  w = net([(x, ww) => { let sent = 0; const t = ww.every(() => { sent += 2; x.upload.onprogress({ loaded: sent, total: 100 }); if (sent >= 100) { ww.stop(t); x.status = 200; x.onload(); } }); }]);
  ok((await run(w, {}, 80)) === true && w.made.length === 1 && !w.made[0].aborted, 'a slow upload that keeps moving (50 s) is never dropped');

  w = net([500, 'error', 'ok']);
  ok((await run(w)) === true && w.made.length === 3, 'a refused try and a network error are retried');
  w = net([500, 500, 500, 'ok']);
  ok((await run(w)) === false && w.made.length === 3, 'three failures: gives up (the export is then freed)');
  w = net(['hang', 'hang', 'hang']);
  ok((await run(w, {}, 200)) === false && w.made.length === 3 && w.clock <= 150e3, 'three hung tries: gives up in about 2 minutes, not 13');

  // Deadline and leaving the page.
  w = net(['hang']);
  ok((await run(w, { deadline: 4e3 })) === false && w.made.length === 0, 'under 5 s left: no new try starts');
  w = net(['hang', 'ok']);
  const leave = new AbortController();
  let r = null;
  const p = up.putWithStallGuard('https://r2/put', body, w.opts({ signal: leave.signal })).then((v) => { r = v; });
  await w.advance(3000);
  leave.abort();
  await w.advance(2000);
  await p;
  ok(r === false && w.made.length === 1 && w.made[0].aborted, 'leaving the page stops the upload, no further try');

  // Allowances by phase (Codex 2026-11-15): sparse progress, connecting, and waiting for the answer.
  w = net([(x, ww) => { let sent = 0; let last = ww.clock; const t = ww.every(() => { if (ww.clock - last >= 18e3) { last = ww.clock; sent += 25; x.upload.onprogress({ loaded: sent, total: 100 }); if (sent >= 100) { ww.stop(t); x.status = 200; x.onload(); } } }); }]);
  ok((await run(w, {}, 120)) === true && w.made.length === 1, 'progress only every 18 s is never dropped');
  w = net([(x, ww) => { const t = ww.every(() => { if (ww.clock >= 35e3) { ww.stop(t); x.upload.onprogress({ loaded: 100, total: 100 }); x.status = 200; x.onload(); } }); }]);
  ok((await run(w, {}, 60)) === true && w.made.length === 1, 'a slow start (35 s connecting) is allowed');
  w = net([(x) => { x.upload.onprogress({ loaded: 100, total: 100 }); }, 'ok']);
  const ta = w.clock;
  ok((await run(w, {}, 120)) === true && w.made.length === 2 && w.made[0].aborted && w.clock - ta >= 60e3 && w.clock - ta <= 66e3, 'everything sent but no answer: waits 60 s, then tries again');
  w = net([(x, ww) => { const t = ww.every(() => x.upload.onprogress({ loaded: 1, total: 100 })); x.t = t; }]);
  ok((await run(w, { deadline: 30e3 }, 60)) === false && w.made[0].aborted && w.made.length === 1, 'the deadline ends a try even while it keeps moving');
  w = net(['ok']);
  const gone = new AbortController(); gone.abort();
  ok((await run(w, { signal: gone.signal })) === false && w.made.length === 0, 'page already left: nothing is sent');
  w = net(['ok']);
  const bad = w.makeXhr; w.makeXhr = () => { const x = bad(); x.send = () => { throw new Error('blocked'); }; return x; };
  ok((await run(w)) === false && w.made.length === 3, 'a try that cannot even start counts as failed and is retried');
  ok(w.ticks.size === 0, 'no timer is left running after the upload');

  // The export's real order (behavioural): demo first with one try, then the video.
  const seq = (scripts) => { const ww = net(scripts); ww.urls = []; const mk = ww.makeXhr; ww.makeXhr = () => { const x = mk(); const open = x.open; x.open = (m, u) => { ww.urls.push(u); open(m, u); }; return x; }; return ww; };
  const exp = async (ww, demo = true) => { let done = null; const p = up.uploadExportFiles({ video: body, demo: demo ? body : null }, { upload: 'https://r2/video', demoUpload: demo ? 'https://r2/demo' : null }, { until: 13 * 60e3, makeXhr: ww.makeXhr, now: ww.now, every: ww.every, stop: ww.stop }).then((r) => { done = r; }); for (let i = 0; i < 300 && done === null; i++) await ww.advance(1000); await p; return done; };
  w = seq(['ok', 'ok']);
  ok((await exp(w)) === true && w.urls.join() === 'https://r2/demo,https://r2/video', 'the demo goes first, then the video');
  w = seq(['hang', 'ok']);
  ok((await exp(w)) === true && w.urls.join() === 'https://r2/demo,https://r2/video' && w.clock <= 55e3, 'a hung demo is given up after one try and the video still goes out');
  w = seq(['ok', 'hang', 'hang', 'hang']);
  ok((await exp(w)) === false && w.urls.filter((u) => u.endsWith('video')).length === 3, 'a video that never goes through: 3 tries, then false (the button then frees the export)');
  w = seq(['ok']);
  ok((await exp(w, false)) === true && w.urls.join() === 'https://r2/video', 'no demo part: just the video');

  // The export button uses it, and progress never steps back.
  const b = fs.readFileSync('src/components/export-button.tsx', 'utf8');
  ok(/const put=await uploadExportFiles\(\{video:blob,demo:made\.demo\}/.test(b) && /if\(!put\)\{/.test(b), 'the export button uploads through it; a failure frees the export');
  ok(!/AbortSignal\.timeout\(until-Date\.now\(\)\)/.test(b) && !/method:"PUT"/.test(b), 'no upload waits out the whole 13 minutes any more');
  ok(/setProgress\(previous=>Math\.max\(previous\?\?0,0\.95\)\)/.test(b), 'after a successful upload the progress never steps back from 99% to 95%');
});
