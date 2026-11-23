// The Export button's timer (founder 2026-11-09: an export with no timer "seemed a lot"; "1 minute is fine as long as
// there is a timer"). Counts down from 1:00, then keeps counting; wired from the click and from a resumed export. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 12;
const eq = (a, b, msg) => { checks++; assert.equal(a, b, msg); };
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

finish('export-clock-checks', EXPECTED, () => checks, () => {
  const c = load('src/lib/export-clock.ts', {}, {}, { Math, Number, String });
  eq(c.exportClockLabel(0, 0), '1:00 left', 'starts at one minute');
  eq(c.exportClockLabel(12.3, 0.01), '0:48 left', 'counts down; no percent before any progress');
  eq(c.exportClockLabel(30, 0.414), '41% · 0:30 left', 'progress and time left');
  eq(c.exportClockLabel(59.5, 0.9), '90% · 0:01 left', 'never shows 0:00 left while time remains');
  eq(c.exportClockLabel(75, 0.95), '95% · Almost done 1:15', 'past a minute: keeps counting, never negative');
  eq(c.exportClockLabel(-5, 0), '1:00 left', 'a clock read before the start is the start');
  eq(c.exportClockLabel(NaN, 0), '1:00 left', 'no time yet: the start');
  const b = fs.readFileSync('src/components/export-button.tsx', 'utf8');
  ok(/\{busy \? \(saving \? SAVING_LABEL : <ExportClock startedAt=\{startedAt\} progress=\{progress\} \/>\) : [^\n]*"Export"\}/.test(b) && /useState\(startedAt\);[\s\S]{0,80}setInterval\(\(\) => setNow\(Date\.now\(\)\), 250\)/.test(b) && /exportClockLabel\(\(now - startedAt\) \/ 1000, progress\)/.test(b), 'the button shows the timer and ticks while busy');
  ok(/blocked\.current=true;setStartedAt\(clockNow\(\)\);setProgress\(0\);setSaving\(false\);\n/.test(b) && /reply\?\.job\)\{blocked\.current=true;setStartedAt\(clockNow\(\)\);setProgress\(0\);setSaving\(false\);setJobId/.test(b), 'the timer starts on Export and on a running export found again');
  // Founder 2026-11-24: after the download opened, "99% · 0:32 left" kept spinning while the copy went to My files.
  eq(c.SAVING_LABEL, 'Saving to My files', 'the saving words');
  ok(/setDone\(\{src:local\.current,[^\n]*\}\);setSaving\(true\);\}/.test(b) && /setProgress\(0\);setSaving\(false\);\n/.test(b), 'once the video is downloadable the button says it is saving, and a new export starts from the timer again');
  ok(/reply\?\.job\)\{blocked\.current=true;setStartedAt\(clockNow\(\)\);setProgress\(0\);setSaving\(false\);setJobId/.test(b), 'a job found again later shows the timer, never stale saving words (Codex 2026-11-24)');
});
