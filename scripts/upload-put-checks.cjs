// Export upload (founder 2026-11-15: "export is stuck"): one upload connection hung and each try was allowed the
// whole 13 minutes. Now each try is dropped after 20 s without progress and the next starts at once; slow but moving
// uploads are left alone; the demo can't hold up the video. Simulated connections and clock. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 36;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const up = load('src/lib/upload-put.ts', { '@/lib/export-alive': load('src/lib/export-alive.ts') }, {}, { setInterval, clearInterval, Blob });

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
  ok(/const put=await uploadWhileAlive\(\{video:blob,demo:made\.demo\}/.test(b) && /if\(!put\)\{/.test(b), 'the export button uploads through it; a failure frees the export');
  ok(!/AbortSignal\.timeout\(until-Date\.now\(\)\)/.test(b) && !/method:"PUT"/.test(b), 'no upload waits out the whole 13 minutes any more');
  ok(/setProgress\(previous=>Math\.max\(previous\?\?0,0\.95\)\)/.test(b), 'after a successful upload the progress never steps back from 99% to 95%');

  // Founder 2026-11-15: the page was changed to Scheduled posts while the export spun, which killed its upload, and
  // the job then waited 15 minutes. Now leaving the page doesn't stop the upload, and it tells the server it's alive.
  const tail = b.slice(b.indexOf('const put=await uploadWhileAlive'), b.indexOf('return "started";\n  }', b.indexOf('const put=await uploadWhileAlive')));
  ok(tail.length > 100 && !/signal/.test(tail), 'leaving the run page never stops the upload or skips freeing a failed export');
  ok(/ping:sent=>post\("alive",\{job:reserved\.job,sent\}\)/.test(b) && /if\(alive\.current\)onToast/.test(tail) && /else if\(alive\.current\)setJobId/.test(tail), 'it pings the server with how much is sent; only page updates wait for the page');
  const live = (opts = {}) => { const ww = net([]); ww.pings = []; const at = (fn, ms) => { let due = ww.clock + ms; return ww.every(() => { if (ww.clock >= due) { due += ms; fn(); } }); }; return Object.assign(ww, { o: { until: 13 * 60e3, now: ww.now, every: at, stop: ww.stop, ping: async (sent) => { ww.pings.push([ww.clock, sent]); }, ...opts } }); };
  // A fake upload that sends 10% every 10 s and finishes after 100 s.
  const slow = (ww, seen) => async (_f, _l, o) => { seen.push(o); for (let i = 1; i <= 10; i++) { await new Promise((res) => { const t = ww.every(() => { if (ww.clock % 10e3 === 0) { ww.stop(t); res(); } }); }); o.onProgress(i / 10); } return true; };
  let seen = [];
  w = live(); w.o.upload = slow(w, seen);
  let res = null; let pr = up.uploadWhileAlive({ video: body }, { upload: 'https://r2/video' }, w.o).then((v) => { res = v; });
  for (let i = 0; i < 130 && res === null; i++) await w.advance(1000);
  await pr;
  ok(res === true && w.pings[0][0] <= 1000 && w.pings[0][1] === 0 && w.pings.length <= 12, 'it tells the server at once that the upload has started (and not more than every 15 s or so)');
  const gaps = w.pings.slice(1).map((p, i) => p[0] - w.pings[i][0]);
  ok(w.pings.length >= 7 && gaps.every((g) => g <= 15e3), 'then at least every 15 s while it lasts');
  ok(w.pings.some((p) => p[1] >= 0.5 && p[1] < 1) && w.pings.every((p, i) => !i || p[1] >= w.pings[i - 1][1]), 'each ping carries how much is sent');
  ok(w.ticks.size === 0 && !('signal' in seen[0]), 'no ping after the upload ends; the upload gets no page signal');
  // Hidden tab: timers may not run, upload progress still pings.
  seen = []; w = live(); const tick = w.every; w.o.every = () => ({}); w.o.stop = () => undefined;
  w.o.upload = async (_f, _l, o) => { for (let i = 1; i <= 6; i++) { await new Promise((res2) => { const t = tick(() => { if (w.clock % 10e3 === 0) { w.ticks.delete(t); res2(); } }); }); o.onProgress(i / 6); } return true; };
  res = null; pr = up.uploadWhileAlive({ video: body }, { upload: 'https://r2/video' }, w.o).then((v) => { res = v; });
  for (let i = 0; i < 90 && res === null; i++) await w.advance(1000);
  await pr;
  ok(res === true && w.pings.length >= 3 && w.pings.slice(1).every((p, i) => p[0] - w.pings[i][0] <= 20e3), 'in a hidden tab whose timers stall, upload progress keeps pinging');
  // A failing ping (network down, server error, even a throw) never touches the upload.
  w = live({ ping: () => { throw new Error('offline'); } }); w.o.upload = async () => true;
  ok((await up.uploadWhileAlive({ video: body }, { upload: 'https://r2/video' }, w.o)) === true, 'a ping that fails is ignored');
  w = live({ ping: async () => { throw new Error('500'); } }); w.o.upload = async () => false;
  ok((await up.uploadWhileAlive({ video: body }, { upload: 'https://r2/video' }, w.o)) === false && w.ticks.size === 0, 'a failed upload still reports false (the export is then freed) and stops pinging');
  // The real upload underneath: a hung try is still dropped and retried.
  w = net(['hang', 'ok']); const pings = [];
  res = null; pr = up.uploadWhileAlive({ video: body }, { upload: 'https://r2/video' }, { until: 13 * 60e3, now: w.now, every: w.every, stop: w.stop, makeXhr: w.makeXhr, ping: async (sent) => { pings.push(sent); } }).then((v) => { res = v; });
  for (let i = 0; i < 120 && res === null; i++) await w.advance(1000);
  await pr;
  ok(res === true && w.made.length === 2 && pings.length >= 3 && w.ticks.size === 0, 'with the real upload: a hung try is retried while pings keep the job alive');
});
