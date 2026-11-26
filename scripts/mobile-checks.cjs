// Phone layout (founder 2026-11-26: ads bring phone traffic; the intended path is desktop). Source checks on the
// layout rules, verified by hand on an emulated iPhone (390 px): no sideways scroll on Videos, a video, Calendar,
// Settings; the editor hands off to desktop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const shell = fs.readFileSync('src/components/app-shell.tsx', 'utf8');
const side = fs.readFileSync('src/components/sidebar-body.tsx', 'utf8');
ok(/<aside className="card hidden w-\[212px\] shrink-0 flex-col p-3 md:flex">/.test(shell), 'the sidebar shows from tablet width up; phones get the full width');
ok(/flex h-full flex-col gap-2 p-2 md:flex-row/.test(shell) && /<MobileBar \/>/.test(shell), 'phones: a top bar above the page');
ok(/md:hidden/.test(side) && /aria-label="Menu"/.test(side) && /<SidebarBody \/>/.test(side), 'the top bar menu opens the same sidebar as a drawer');
ok(/if \(shownFor !== pathname\) \{ setShownFor\(pathname\); setOpen\(false\); \}/.test(side) && /e\.key === "Escape"/.test(side), 'the drawer closes on a new page and on Escape');
const cal = fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8');
ok(/grid-cols-1 divide-x divide-line overflow-y-auto md:grid-cols-7/.test(cal) && /\$\{i === shownDay \? "flex" : "hidden"\} min-w-0 flex-col md:flex/.test(cal), 'calendar: one day at a time on phones, the week on desktop');
ok(/role="tablist" aria-label="Day" className="grid grid-cols-7 gap-1 border-b border-line px-2 py-2 md:hidden"/.test(cal) && /setMobileDay\(null\)/.test(cal), 'phones pick the day from a strip; a new week starts on today or Monday');
const ed = fs.readFileSync('src/components/editor-tools.tsx', 'utf8');
ok(/<PhoneHandoff onClose=\{onClose\} \/>/.test(ed) && /absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-panel p-6 text-center md:hidden/.test(ed), 'editor on a phone: the desktop handoff screen, not a squeezed timeline');
ok(/Copy link/.test(ed) && /mailto:\?subject=/.test(ed), 'the handoff copies or emails the link to this video');
const list = fs.readFileSync('src/components/runs-list.tsx', 'utf8');
ok(/btn-primary ml-auto whitespace-nowrap/.test(list) && /hidden rounded-lg bg-raised p-0\.5 min-\[400px\]:flex/.test(list), '"New video" stays on one line on phones; the view toggle hides under 400 px so 320 px fits');
ok(/max-md:\[&>\*:not\(\[data-handoff\]\)\]:hidden/.test(ed) && /data-handoff className=/.test(ed), 'on phones the editor behind the handoff is hidden, not just covered (keyboards and screen readers)');
ok(/el\.inert = true/.test(side) && /closeButton\.current\?\.focus\(\)/.test(side) && /trigger\?\.focus\(\)/.test(side), 'the open menu makes the page behind inert, focuses inside, and returns focus on close');
ok(!/[—–]/.test(ed.slice(ed.indexOf('function PhoneHandoff')) + side.slice(side.indexOf('export function MobileBar'))), 'no em or en dashes in the new copy');
ok(/matchMedia\("\(min-width: 48rem\)"\)/.test(side) && /if \(desktop\.matches\) setOpen\(false\)/.test(side), 'rotating to desktop width closes the menu, so the page never stays inert');
assert.equal(checks, 13);
console.log(`mobile-checks: ${checks} checks pass`);
