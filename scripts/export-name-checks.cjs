// Export download names (founder 2026-11-08): the hook's first words plus the export's day and time, so names read
// like a person made them and two exports never share one, even with the same hook start or on the same day. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 20;
const eq = (a, b, msg) => { checks++; assert.equal(a, b, msg); };
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

const n = load('src/lib/export-name.ts', {}, {}, { Intl, Date, Number, Object });
const NY = 'America/New_York';

finish('export-name-checks', EXPECTED, () => checks, () => {
  // First words of the hook.
  eq(n.hookWords('My app had only 4 users, then I did this'), 'my_app_had_only', 'first four words, lower case');
  eq(n.hookWords("I didn't expect THIS!!"), 'i_didnt_expect_this', 'apostrophes dropped, punctuation gone');
  eq(n.hookWords('Café crème: résumé'), 'cafe_creme_resume', 'accents become plain letters');
  eq(n.hookWords('POV:   you   launch'), 'pov_you_launch', 'extra spaces and colons collapse');
  eq(n.hookWords(''), 'mavya_video', 'no hook text: plain fallback');
  eq(n.hookWords(undefined), 'mavya_video', 'missing hook text: plain fallback');
  eq(n.hookWords('🔥🔥🔥'), 'mavya_video', 'emoji-only hook: fallback, no empty name');
  eq(n.hookWords('supercalifragilisticexpialidocious antidisestablishmentarianism x'), 'supercalifragilisticexpialidocious', 'long words stop at 40 characters');
  eq(n.hookWords('a'.repeat(90)), 'a'.repeat(40), 'one huge word is cut to 40');

  // Day and time stamp.
  eq(n.exportStamp('2026-11-08T19:14:00Z', NY), 'nov8_214pm', 'afternoon in New York');
  eq(n.exportStamp('2026-11-08T14:05:00Z', NY), 'nov8_905am', 'morning, minutes keep their zero');
  eq(n.exportStamp('2026-11-09T04:30:00Z', NY), 'nov8_1130pm', 'local day, not UTC day');
  eq(n.exportStamp('not a date', NY), '', 'bad time: no stamp');

  // Whole names.
  const hook = 'My app had only 4 users then I did this';
  eq(n.exportFileName(hook, '2026-11-08T19:14:00Z', NY), 'my_app_had_only_nov8_214pm', 'words then stamp');
  ok(n.exportFileName(hook, '2026-11-08T19:14:00Z', NY) !== n.exportFileName('My app had only 2 users and it hurt', '2026-11-08T21:40:00Z', NY), 'same hook start, same day: different names');
  ok(n.exportFileName(hook, '2026-11-08T19:14:00Z', NY) !== n.exportFileName(hook, '2026-11-08T19:15:00Z', NY), 'same video exported a minute later: different name');
  eq(n.exportFileName(hook, 'bad', NY), 'my_app_had_only', 'bad time: words alone');
  ok(/^[a-z0-9_]+$/.test(n.exportFileName("What's up?! 100% real", '2026-11-08T19:14:00Z', NY)), 'only safe file-name characters');

  // Links and wiring.
  eq(n.downloadHref('/api/media/abc.mp4', 'my_app_nov8_214pm'), '/api/media/abc.mp4?download=my_app_nov8_214pm', 'server link gets the name');
  const button = fs.readFileSync('src/components/export-button.tsx', 'utf8');
  const panel = fs.readFileSync('src/components/history-panel.tsx', 'utf8');
  ok(/exportFileName\(run\.hook\.text, done\.at\)/.test(button) && /downloadHref\(done\.src, name\)/.test(button) && /downloadHref\(x\.value\.src, exportFileName\(x\.hookText, x\.value\.at\)\)/.test(panel) && /downloadName=\{exportFileName\(x\.hookText, x\.value\.at\)\}/.test(panel) && /download=\{downloadName \? `\$\{downloadName\}\.mp4` : true\}/.test(panel), 'Export dialog and My files both use the name');
});
