// Seamless cuts' sound fill (render/sound.mjs, shared by the browser and server exports) and the render worker's job
// order (render/queue.mjs). Regression checks for the 2026-11-06 problems: silence at sped-up/slowed piece edges,
// 10-60 ms pieces left silent, a click at the 0.5x tail, and previews waiting behind exports. Offline.
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const root = path.join(__dirname, '..');
  const { fillSound } = await import(path.join(root, 'render/sound.mjs'));
  const { nextJob } = await import(path.join(root, 'render/queue.mjs'));
  let checks = 0;
  const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

  // 1. fillSound: exactly the planned samples, no silence the source doesn't have, no step bigger than the source's
  //    own largest (no click), for speeds 0.5x to 2x and pieces from 10 ms to 3.3 s.
  const R = 48000;
  const cases = [[3.34, 87], [3.162, 87], [1.842, 55], [2.587, 68], [1, 26], [1, 60], [1, 45], [0.6, 36], [1.2, 72], [0.05, 3], [0.06, 4], [0.01, 2], [0.05, 1], [1.532, 46], [0.0426, 2], [0.045, 1]];
  for (const [secs, frames] of cases) {
    const len = Math.round(secs * R), n = frames * 1600;
    const sine = new Float32Array(len).map((_, i) => 0.125 * Math.sin((2 * Math.PI * 997 * i) / R));
    const dc = new Float32Array(len).fill(0.125);
    for (const [name, x, maxStep] of [['sine', sine, (0.125 * 2 * Math.PI * 997) / R], ['dc', dc, 0]]) {
      const out = fillSound([x, x], n)[0];
      let run = 0, longest = 0, step = 0;
      for (let i = 0; i < out.length; i++) {
        if (Math.abs(out[i]) < 1e-3) { run++; longest = Math.max(longest, run); } else run = 0;
        if (i) step = Math.max(step, Math.abs(out[i] - out[i - 1]));
      }
      ok(out.length === n, `${secs}s -> ${frames} frames ${name}: ${out.length}/${n} samples`);
      ok(longest <= (name === 'sine' ? 3 : 0), `${secs}s -> ${frames} frames ${name}: silent run of ${longest} samples`);
      ok(step <= maxStep * 1.6 + 1e-6, `${secs}s -> ${frames} frames ${name}: largest step ${step.toFixed(4)} (a click)`);
    }
  }
  // Same length: copied unchanged.
  const same = new Float32Array(4800).map((_, i) => Math.sin(i / 9));
  ok(fillSound([same, same], 4800)[0].every((v, i) => v === same[i]), 'a piece already its planned length is copied unchanged');

  // 2. Render worker order: copies first, taking turns one each with waiting exports; nothing to do -> null.
  const order = (exports, copies) => {
    const out = [];
    let inARow = 0;
    for (let k = nextJob(exports, copies, 0); k; k = nextJob(exports, copies, inARow)) {
      if (k === 'copy') { copies--; inARow++; out.push('c'); } else { exports--; inARow = 0; out.push('e'); }
    }
    return out.join('');
  };
  ok(order(2, 3) === 'cecec', `2 exports, 3 copies: ${order(2, 3)}`);
  ok(order(0, 3) === 'ccc', 'copies alone run back to back');
  ok(order(3, 0) === 'eee', 'exports alone run back to back');
  ok(order(2, 7) === 'cecec' + 'cccc', `copies never hold an export back by more than one: ${order(2, 7)}`);
  ok(nextJob(0, 0, 0) === null, 'nothing to do');

  console.log(`sound-queue-checks: ${checks} checks pass`);
})().catch((e) => { console.error(e); process.exit(1); });
