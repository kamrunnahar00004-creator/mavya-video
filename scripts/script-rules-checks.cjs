// Script prompt (founder 2026-11-26): the viral reel the founder picked leads, then the truth about the app, then
// founder-approved house rules that only fill gaps; the number of demo shots is the model's judgment of what gets the
// most views (no fixed count), with its reason kept on the script. Offline source and module checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const rules = load('src/lib/script-rules.ts');
const route = fs.readFileSync('src/app/api/runs/[id]/script/route.ts', 'utf8');
const hook = fs.readFileSync('src/app/api/runs/[id]/hook-text/route.ts', 'utf8');

ok(rules.SCRIPT_RULES.length >= 1 && rules.SCRIPT_RULES.every((r) => r.rule && r.why && /^\d{4}-\d{2}-\d{2}$/.test(r.approved)), 'every rule has the rule, why, and the date the founder approved it');
ok(rules.scriptRulesText().split('\n').length === rules.SCRIPT_RULES.length && rules.scriptRulesText().startsWith('1. '), 'rules go into the prompt numbered, one per line');
ok(!/[–—]/.test(rules.SCRIPT_RULES.map((r) => r.rule + r.why).join('')), 'no em or en dashes in the rules');

const p1 = route.indexOf('THE VIRAL REEL THE FOUNDER PICKED leads'), p2 = route.indexOf('2. THE TRUTH ABOUT THIS PRODUCT'), p3 = route.indexOf('3. HOUSE RULES');
ok(p1 > 0 && p2 > p1 && p3 > p2, 'priority order: the picked viral reel, then product truth, then house rules');
ok(/Never let them override the reel's voice/.test(route) && /\$\{scriptRulesText\(\)\}/.test(route), 'house rules only fill gaps and come from the rules file');
ok(/Keep the viral reel's own story shape/.test(route) && /BEFORE \(the pain; skip this shot only when the hook already shows it\)/.test(route) && /AFTER: the pain from the hook or BEFORE, now fixed/.test(route), 'story shape follows the reel; the pain is in the hook or a before shot, never missing');
ok(!/3 to 7 shots/.test(route) && /There is no default count; it can be 2 or 9/.test(route) && /exactly as many shots as shotPlan says/.test(route), 'shot count is the model\'s judgment, no fixed range');
ok(/"shotPlan"/.test(route) && /required: \["payoff", "story", "shotPlan"/.test(route) && /shotPlan: s\(out\.shotPlan, 300\)/.test(route), 'the reason for the count is asked for and kept on the script');
ok(/maxItems: 10/.test(route) && /capShots\(Array\.isArray\(out\.shots\)/.test(route) && !/\.slice\(0, 7\)/.test(route), 'only a safety cap of 10 shots');
{ const r = load('src/app/api/runs/[id]/script/route.ts', { '@/lib/edit': { reelCode: () => '' }, '@/lib/server/ai-budget': {}, '@/lib/server/gemini': {}, '@/lib/server/store': {}, '@/lib/server/who': {}, '@/lib/script-rules': rules, 'node:fs/promises': {}, 'node:os': {}, 'node:path': {} });
  const many = Array.from({ length: 12 }, (_, i) => i); const capped = r.capShots(many);
  ok(capped.length === 10 && capped[9] === 11 && r.capShots([1, 2, 3]).length === 3, 'past 10 shots, the last (payoff) shot is kept'); }
ok(/shotPlan\?: string;/.test(fs.readFileSync('src/lib/types.ts', 'utf8')), 'VideoScript keeps shotPlan (optional, older scripts have none)');
ok(/HOUSE RULES \(apply only where the viral hook's voice does not already decide; never override it\)/.test(hook) && /\$\{scriptRulesText\(\)\}/.test(hook), 'new hook lines follow the same rules, after the hook\'s voice');

const g = fs.readFileSync('src/lib/server/gemini.ts', 'utf8');
ok(/export const PRO_MODEL = "gemini-pro-latest"/.test(g) && /models\/\$\{opts\.model \?\? MODEL\}/.test(g) && /opts\.timeoutMs \?\? 120_000/.test(g), 'gemini helper takes a model and a timeout; Flash stays the default');
ok(/const deadline = Date\.now\(\) \+ 170_000;/.test(route) && /model: PRO_MODEL, timeoutMs: Math\.max\(1_000, Math\.min\(110_000, left\(\) - 45_000\)\)/.test(route) && /if \(left\(\) < 15_000\) throw/.test(route) && /timeoutMs: left\(\) \}\)/.test(route), 'script: Pro first, Flash fallback, both inside one 170 s deadline from the click');
ok(!/PRO_MODEL/.test(hook), 'hook-line regenerate stays on Flash (fast, clicked often)');
ok(rules.SCRIPT_RULES.some((r) => /2 to 5 words/.test(r.rule)) && rules.SCRIPT_RULES.some((r) => /Ad-safe/.test(r.rule)), 'founder-approved rules: short captions, ad-safe wording');
// Founder 2026-11-27: the first Pro script copied the viral reel's 6 s shot lengths, left captions empty, used
// "POV" and vague steps, and invented a record button. Each is now ruled out in the prompt.
ok(/SECONDS come from THIS product's action, never from the viral reel's shot lengths/.test(route) && /not its actions or timings/.test(route), 'shot seconds follow the product action, never copied from the reel');
ok(/CAPTIONS \(text\): every shot has one, even when the viral reel's demo has none/.test(route) && /Never empty, never a repeat of the hook text/.test(route), 'every shot has a 2 to 5 word caption, even when the reel has none');
ok(/The last shot shows the RESULT the product promises/.test(route), 'the demo ends on the result, not just the last screen');
ok(/never invent one such as a record or export button/.test(route) && /"POV", "close-up", "handheld"/.test(route) && /never "record your app" or "use the app"/.test(route), 'specific steps: real screens and buttons, no invented buttons, no film words');
// Founder 2026-11-27: "very very actionable and concrete and extremely specific to the product".
const prod = fs.readFileSync('src/app/api/runs/[id]/product/route.ts', 'utf8');
ok(/"uiWords": \[/.test(prod) && /then in brackets what it is and where/.test(prod) && /uiWords: list\(brief\?\.uiWords, 20\)/.test(prod), 'step 1 reads the product\'s exact on-screen words, each saying what it is');
ok(/each one: the screen's name, the exact action with the button or field quoted as the site writes it/i.test(prod), 'demoFlow is concrete steps with quoted buttons');
ok(/BE EXTREMELY SPECIFIC TO THIS PRODUCT/.test(route) && /could a stranger film it without asking a single question\? If not, rewrite it/.test(route) && /only tap what is a button/.test(route) && /never quote tags, headers or counters just to quote them/.test(route), 'script quotes real buttons and real examples, and passes the stranger test');
ok(/uiWords\?: string\[\];/.test(fs.readFileSync('src/lib/types.ts', 'utf8')), 'ProductBrief keeps uiWords (older briefs have none)');
const EXPECTED = 24;
assert.equal(checks, EXPECTED, `script-rules-checks: ${checks} of ${EXPECTED}`);
console.log(`script-rules-checks: ${checks} checks pass`);
