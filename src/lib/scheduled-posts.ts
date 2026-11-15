// Scheduled posts (founder 2026-11-15): exported videos queued on a calendar and posted to Instagram Reels and the
// Facebook Page at their time. Shared by the page and the server (src/lib/server/scheduled-posts.ts).

export type Target = "instagram" | "facebook";
export const TARGETS: Target[] = ["instagram", "facebook"];
export type PostState = "scheduled" | "posting" | "posted" | "failed";

/** One network's progress. `step` is where posting got to, so a tick that dies mid-way resumes without posting twice. */
export type TargetResult = {
  state: "waiting" | "working" | "done" | "failed";
  step?: string;
  container?: string;
  video?: string;
  id?: string;
  url?: string;
  error?: string;
  note?: string;
  since?: string;
};

export type Post = {
  id: string;
  mediaId: string;
  title: string;
  hook: string;
  captions: Partial<Record<Target, string>>;
  targets: Target[];
  at: string;
  state: PostState;
  result: Partial<Record<Target, TargetResult>>;
  error: string | null;
  createdAt: string;
};

export type Templates = Record<Target, string>;

/** The founder's captions (2026-11-15). {hook} is the video's hook words. */
export const DEFAULT_TEMPLATES: Templates = {
  instagram: '{hook}\n\nlink in bio 🔗 or comment "APP" and i\'ll DM it\n\n#appmarketing #ugcads #indiehacker #buildinpublic #saasmarketing',
  facebook: "{hook}\n\nCreate your own video 👉 mavya.app",
};

/** Instagram's caption limit (2,200 characters); Facebook's is far larger, the same cap keeps both in step. */
export const CAPTION_MAX = 2200;
/** One batch, and how far ahead a post may be (Instagram allows 100 a day; Meta Business Suite 29 days ahead). */
export const MAX_BATCH = 100;
export const MAX_DAYS_AHEAD = 60;

/** A template with the hook filled in; with no hook, its line goes rather than leaving a blank first line. */
export function fillCaption(template: string, hook: string): string {
  const words = hook.replace(/\s+/g, " ").trim();
  const text = words ? template.split("{hook}").join(words) : template.replace(/^[ \t]*\{hook\}[ \t]*(\r?\n)*/m, "").split("{hook}").join("");
  return text.trim().slice(0, CAPTION_MAX);
}

/**
 * Times for `count` posts spread through one day: from `start` to `end` (minutes after midnight, local), evenly,
 * first at start and last at end (one post: at start). Returned as minutes after midnight, rounded to 5 minutes.
 */
export function spreadTimes(count: number, start: number, end: number): number[] {
  if (count <= 0) return [];
  if (count === 1 || end <= start) return Array.from({ length: count }, () => start);
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.min(end, Math.round((start + i * step) / 5) * 5));
}

/** The overall state from each network's: posted when every target is done, failed when one failed and none is still going. */
export function rollUp(targets: Target[], result: Post["result"]): PostState {
  const states = targets.map((t) => result[t]?.state ?? "waiting");
  if (states.every((s) => s === "done")) return "posted";
  if (states.some((s) => s === "failed") && states.every((s) => s === "done" || s === "failed")) return "failed";
  return "posting";
}

/** Why a create or edit is refused (null: fine). `now` in ms. */
export function badPost(p: { at?: unknown; targets?: unknown; captions?: unknown }, now: number): string | null {
  const at = typeof p.at === "string" ? Date.parse(p.at) : NaN;
  if (!Number.isFinite(at)) return "Pick a time.";
  if (at > now + MAX_DAYS_AHEAD * 86_400_000) return `Pick a time within ${MAX_DAYS_AHEAD} days.`;
  if (!Array.isArray(p.targets) || !p.targets.length || !p.targets.every((t) => TARGETS.includes(t)) || new Set(p.targets).size !== p.targets.length) return "Pick Instagram, Facebook or both.";
  const caps = p.captions as Record<string, unknown> | undefined;
  if (!caps || typeof caps !== "object") return "Add a caption.";
  for (const t of p.targets as Target[]) if (typeof caps[t] !== "string" || caps[t].length > CAPTION_MAX) return `The ${t === "instagram" ? "Instagram" : "Facebook"} caption must be up to ${CAPTION_MAX} characters.`;
  return null;
}

/** "in 2 h 5 min", "in 45 s": the time left before a scheduled post goes out. */
export function countdown(ms: number): string {
  if (ms <= 0) return "posting soon";
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `in ${d} d ${h} h`;
  if (h) return `in ${h} h ${m} min`;
  if (m) return `in ${m} min ${s % 60} s`;
  return `in ${s} s`;
}

/**
 * Each picked video's time, in pick order: the one set for it by hand, else the spread time in its place (founder
 * 2026-11-15: "a feature that is per video, i can schedule anytime i want"). Null where it has neither.
 */
export function finalTimes(picked: string[], spread: number[], own: Record<string, number | null>): (number | null)[] {
  // A box cleared by hand stays empty (null) until a time or Auto is picked; it never falls back to the spread.
  return picked.map((id, i) => (Object.hasOwn(own, id) ? own[id] : spread[i] ?? null));
}

/** Why a picked video's time can't be used (null: fine): none, or not at least a minute ahead. */
export function timeProblem(t: number | null, now: number): string | null {
  if (t === null) return "Pick a time";
  if (t <= now + 60_000) return "That time has passed";
  return null;
}

/** A small seeded random generator (mulberry32): the same seed gives the same times, so the screen doesn't jump. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MIN_GAP = 90, MAX_GAP = 120;

/**
 * Random posting times for `count` videos (founder 2026-11-15, against spam filters): each day from `from` to `to`
 * (minutes after midnight), the first at a random time in its first half hour, then 1.5 to 2 hours apart at random,
 * never on a quarter hour; what doesn't fit rolls over to the next days. `earliest`: the first day starts no sooner
 * (minutes after its midnight, e.g. now + a few minutes when that day is today). Returns minutes after the first day's
 * midnight; consecutive posts are always at least MIN_GAP apart, overnight too.
 */
export function randomSlots(count: number, from: number, to: number, rng: () => number, earliest = 0): number[] {
  const out: number[] = [];
  if (count <= 0 || to <= from) return out;
  const jitter = (n: number) => Math.floor(rng() * (n + 1));
  const offQuarter = (m: number) => (m % 15 === 0 ? m + 1 + jitter(2) : m);
  let day = 0;
  let next = offQuarter(Math.max(from, earliest) + jitter(30));
  for (let guard = 0; out.length < count && guard < count * 4 + 400; guard++) {
    const end = day * 1440 + to;
    if (next > end || next < day * 1440 + from) {
      // Next day: its window's start plus a random bit, and never sooner than the gap after the last post.
      day++;
      const last = out.length ? out[out.length - 1] : -Infinity;
      next = offQuarter(Math.max(day * 1440 + from + jitter(30), last + MIN_GAP));
      continue;
    }
    out.push(next);
    next = offQuarter(next + MIN_GAP + jitter(MAX_GAP - MIN_GAP - 3));
  }
  return out;
}

/**
 * The real posting moments for randomSlots' minutes (Codex 2026-11-15, clock changes): `wall` turns a minute after the
 * first day's midnight into a moment (local clock; a time that doesn't exist on a spring-forward day comes out an hour
 * later). Then every moment is made at least `earliest` and at least MIN_GAP after the one before, on the real clock,
 * and must sit inside the day's window (`fits`); one that doesn't moves to the next window's start (`nextStart`). So a
 * clock change can never squeeze two posts together, put one in the past, or outside Earliest/Latest.
 */
export function slotMoments(minutes: number[], wall: (minute: number) => number, earliest: number, fits: (t: number) => boolean = () => true, nextStart: (t: number) => number = (t) => t): number[] {
  const out: number[] = [];
  const offRound = (t: number, m: number) => (Math.floor(t / 60_000) % 15 === 0 ? t + 60_000 * (1 + (m % 2)) : t);
  for (const m of minutes) {
    const floor = Math.max(earliest, out.length ? out[out.length - 1] + MIN_GAP * 60_000 : -Infinity);
    let t = offRound(Math.max(wall(m), floor), m);
    for (let guard = 0; !fits(t) && guard < 400; guard++) t = offRound(Math.max(nextStart(t), floor), m);
    out.push(t);
  }
  return out;
}

type HookText = { text?: unknown; start?: unknown; end?: unknown; x?: unknown; y?: unknown; id?: unknown };

/**
 * The hook words for a caption: what the video itself shows during its hook (founder 2026-11-15: "the hook should be
 * the hook of my video", e.g. "SaaS + Insta reels"), not the library hook's own words. Every non-empty text box that
 * starts while the hook plays, read top to bottom (then left to right), on one line. Null when there are none.
 */
export function hookWords(texts: unknown, hook: { start?: unknown; end?: unknown } | null | undefined): string | null {
  if (!Array.isArray(texts)) return null;
  const list = texts as HookText[];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const hs = num(hook?.start) ?? 0, he = num(hook?.end);
  const ownHook = list.find((t) => t?.id === "hook");
  // How long the hook plays on the timeline: its trimmed length, else the hook text's own end, else 3 s.
  const length = he !== null && he > hs ? he - hs : num(ownHook?.end) ?? 3;
  const words = list
    .filter((t) => typeof t?.text === "string" && t.text.trim() && (num(t.start) ?? 0) < length - 0.01)
    .sort((a, b) => (num(a.y) ?? 0) - (num(b.y) ?? 0) || (num(a.x) ?? 0) - (num(b.x) ?? 0))
    .map((t) => (t.text as string).replace(/\s+/g, " ").trim())
    .join(" ");
  return words || null;
}
