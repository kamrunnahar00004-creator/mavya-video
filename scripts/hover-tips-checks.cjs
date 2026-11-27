// Hover text on every icon button (founder 2026-11-27: "for every symbol have a hover over text"): one app-wide
// listener shows the control's name in a black tip, skips controls with visible words or their own tip, and moves
// `title` to data-tip so the browser's slow tooltip never doubles it. Offline: tipFor with tiny fake elements.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const m = load('src/components/hover-tips.tsx', { react: { useEffect() {}, useLayoutEffect() {}, useRef: () => ({}), useState: (v) => [v, () => {}] }, 'react/jsx-runtime': { jsx: () => null, jsxs: () => null } });
const el = ({ label = '', title = '', text = '', tip = '', noTip = false, ownTip = false, siblingTip = false, srOnly = '' } = {}) => {
  const attrs = { 'aria-label': label };
  const e = {
    title, innerText: text, textContent: text, dataset: tip ? { tip } : {},
    getAttribute: (k) => attrs[k] ?? null, removeAttribute(k) { if (k === 'title') this.title = ''; },
    closest: (s) => (s === '[data-no-tip]' && noTip ? {} : null),
    querySelector: (s) => (s === '[role="tooltip"]' && ownTip ? {} : null),
    querySelectorAll: () => (srOnly ? [{ textContent: srOnly }] : []),
    parentElement: { querySelector: () => (siblingTip ? {} : null) },
  };
  return e;
};

ok(m.tipFor(el({ label: 'Delete text' })) === 'Delete text', 'icon button: its aria-label shows');
const t = el({ title: 'Advanced settings' });
ok(m.tipFor(t) === 'Advanced settings' && t.title === '' && t.dataset.tip === 'Advanced settings', 'title moves to data-tip (no double browser tooltip)');
ok(m.tipFor(el({ label: 'Save', text: 'Save' })) === null, 'a button with visible words gets no tip');
ok(m.tipFor(el({ label: 'Regenerate', siblingTip: true })) === null && m.tipFor(el({ label: 'Add', ownTip: true })) === null, 'buttons that draw their own tip are left alone');
ok(m.tipFor(el({ label: 'Menu', noTip: true })) === null && m.tipFor(el({})) === null, 'opted out, or no name: nothing');
const src = fs.readFileSync('src/components/hover-tips.tsx', 'utf8');
ok(/if \(e\.pointerType !== "mouse"\) return;/.test(src) && /el\.matches\(":focus-visible"\)/.test(src), 'mouse hover and keyboard focus only (no tips stuck on touch)');
ok(/<HoverTips \/>/.test(fs.readFileSync('src/app/layout.tsx', 'utf8')), 'mounted once for the whole app');
ok(/aria-label="Add emoji"/.test(fs.readFileSync('src/components/text-controls.tsx', 'utf8')) && /aria-label="Font, color and style"/.test(fs.readFileSync('src/components/text-controls.tsx', 'utf8')), 'clear names: Add emoji; Font, color and style');

const kept = el({ title: 'Browser text', tip: 'Chosen tip' });
ok(m.tipFor(kept) === 'Chosen tip' && kept.title === '', 'a data-tip set on purpose is never overwritten by title (Codex)');
ok(m.tipFor(el({ label: 'Close', text: 'Close', srOnly: 'Close' })) === 'Close', 'screen-reader-only text does not count as visible words (Codex)');
ok(/document\.addEventListener\("pointerout", out\)/.test(src) && /!current\.current\.isConnected\) hide\(\)/.test(src), 'hides when the mouse leaves the window or the button disappears (Codex)');
// Founder 2026-11-27: hover text a 12-year-old understands at once. No editor jargon in any title or aria-label.
const files = fs.readdirSync('src/components').filter((f) => f.endsWith('.tsx')).map((f) => fs.readFileSync(path.join('src/components', f), 'utf8')).join('\n');
const shown = (files.match(/(?:title|aria-label)=(?:"[^"]*"|\{[^}]*\})/g) || []).join('\n');
ok(!/playhead|keyframe|Instagram's API|organic|Advanced settings|"Magnet"/i.test(shown), 'no jargon in hover text (playhead, keyframe, API, organic, advanced)');
ok(/Add a zoom point here/.test(files) && /Clips stick together\. Click to move them freely\./.test(files) && /title="Cut here \(S\)"/.test(files) && /title="More settings"/.test(files), 'plain words: zoom point, here, stick together, more settings');
const EXPECTED = 13;
assert.equal(checks, EXPECTED, `hover-tips-checks: ${checks} of ${EXPECTED}`);
console.log(`hover-tips-checks: ${checks} checks pass`);
