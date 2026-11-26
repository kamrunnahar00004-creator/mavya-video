/**
 * Script rules (founder 2026-11-26): what we learned makes a hook + demo script get views, added ONLY with the
 * founder's approval, one line each with where it came from. They are the third priority in the script prompt:
 *   1. the viral reel the founder picked (its format leads: most of the script),
 *   2. the truth about their app (never a feature, number or result the brief and notes do not support),
 *   3. these rules, which fill gaps or fix what would break for an app; they never override the reel's voice.
 * Claude proposes a rule when monitoring shows a pattern; the founder approves it; then it goes here. Never added
 * automatically.
 */
export type ScriptRule = { rule: string; why: string; approved: string };

export const SCRIPT_RULES: ScriptRule[] = [
  {
    rule: "Hook text is short and reads almost like a question. When the founder's notes give a real number, put the number and the word \"app\" in it (e.g. \"my app got 500 users from 1 reel??\").",
    why: "Founder's own best reel hook (\"much shorter\", \"almost a question\", \"number and app in the hook\").",
    approved: "2026-11-26",
  },
  {
    rule: "Pain first, proof last: open on the problem the app fixes (in the hook or the first shot), end on the real result.",
    why: "Founder's reel script (name the pain first, real proof last).",
    approved: "2026-11-21",
  },
  {
    rule: "Choose the number of demo shots by judgment: whatever this app and this reel need to get the most views. No fixed count. Every shot must earn its place; when unsure, the shorter version.",
    why: "Founder: not always 3, 4 or 5; it depends on the app and on what will get the best views.",
    approved: "2026-11-26",
  },
  {
    rule: "Captions are 2 to 5 words each, one idea per shot, readable in 1 second.",
    why: "Founder's best reel captions (\"my app demo flopped\", \"found a hook with 5.6M views\", \"select it\").",
    approved: "2026-11-26",
  },
  {
    rule: "Ad-safe wording: never \"steal\", never \"you will get\" a result, no money promises.",
    why: "Users may run their reel as a paid ad; Meta rejects that wording.",
    approved: "2026-11-26",
  },
];

/** The rules as prompt lines, numbered. */
export const scriptRulesText = (rules: ScriptRule[] = SCRIPT_RULES) => rules.map((r, i) => `${i + 1}. ${r.rule}`).join("\n");
