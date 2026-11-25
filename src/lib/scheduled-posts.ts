// Content calendar (founder 2026-11-26; was "Scheduled posts", 2026-11-15): every user plans their exported videos
// on a calendar for Instagram, Facebook, TikTok and YouTube Shorts, copies a ready caption for each, posts them by
// hand, and marks each one posted with its link. Nothing posts by itself (founder 2026-11-26: auto-posting "is not
// useful"). Shared by the page and the server (src/lib/server/scheduled-posts.ts).

export type Target = "instagram" | "facebook" | "tiktok" | "youtube";
export const TARGETS: Target[] = ["instagram", "facebook", "tiktok", "youtube"];
export const NAMES: Record<Target, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube Shorts" };
/** Planned until every picked platform is marked posted. ("posting" and "failed" are from the old auto-posting.) */
export type PostState = "scheduled" | "posted";

/** One platform's record: when it was posted, its link, and its views (typed in). */
export type TargetResult = {
  postedAt?: string;
  url?: string;
  views?: number;
  viewsAt?: string;
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
  createdAt: string;
  /** The post's revision when it was read: an edit from an older copy (another tab) is refused, not merged. */
  updatedAt?: string;
};

/**
 * The user's app, read once by the analyzer from the link they paste (founder 2026-11-26): its domain (no https://)
 * and the hashtags for its niche. Both can be typed by hand too, so the calendar works without a plan.
 */
export type AppProfile = { url: string; domain: string; name: string; hashtags: string[]; analyzedAt?: string };
export const NO_APP: AppProfile = { url: "", domain: "", name: "", hashtags: [] };

export type Templates = Record<Target, string>;

/**
 * One caption format for every platform (founder 2026-11-26), each tuned so it is safe there: {hook} is the video's
 * hook words, {domain} the app's domain, {hashtags} its hashtags (HASHTAGS of them). TikTok and YouTube lead with
 * "comment" because a TikTok bio link needs a business account or 1,000 followers, and Shorts description links are
 * not clickable. YouTube's first line is the Short's title.
 */
export const DEFAULT_TEMPLATES: Templates = {
  instagram: '{hook}\n\n{domain} 🔗 link in bio, or comment "APP" and i\'ll DM it\n\n{hashtags}',
  facebook: "{hook}\n\n👉 {domain}\n\n{hashtags}",
  tiktok: '{hook}\n\ncomment "APP" and i\'ll DM you {domain} 🔗\n\n{hashtags}',
  youtube: '{hook}\n\ncomment "APP" for the link 🔗 {domain}\n\n{hashtags}',
};
/** Hashtags per platform: Instagram allows 5 a post; Facebook and YouTube show 3; TikTok 5. */
export const HASHTAGS: Record<Target, number> = { instagram: 5, facebook: 3, tiktok: 5, youtube: 3 };
/** YouTube Shorts titles: 100 characters. */
export const TITLE_MAX = 100;

/** Captions up to Instagram's 2,200 characters, the same cap on every platform. */
export const CAPTION_MAX = 2200;
/** One batch, and how far ahead or back a post may be (back: to log videos already posted). */
export const MAX_BATCH = 100;
export const MAX_DAYS_AHEAD = 60;
export const MAX_DAYS_BACK = 365;

/** "#appmarketing", from "App Marketing", "#app-marketing" or "appmarketing": lower case, letters and digits only. */
export function tag(raw: string): string {
  const t = raw.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return t ? `#${t.slice(0, 40)}` : "";
}
/** Hashtags from a list or "#a #b, c": cleaned, without repeats, up to 15. */
export function tagList(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
  return [...new Set(parts.map(tag).filter(Boolean))].slice(0, 15);
}
/** "yourapp.com" from "https://www.yourapp.com/pricing"; "" when it isn't a web address. */
export function domainOf(raw: string): string {
  let v = raw.trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!["http:", "https:"].includes(u.protocol) || !u.hostname.includes(".")) return "";
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** A template filled for one platform: the hook, the app's domain and that platform's hashtags. */
export function captionFor(t: Target, template: string, hook: string, app: Pick<AppProfile, "domain" | "hashtags">): string {
  const tags = app.hashtags.slice(0, HASHTAGS[t]).join(" ");
  // A missing domain or hashtags drops its placeholder, never leaving "{domain}" or a stray blank block.
  const text = template.split("{domain}").join(app.domain).split("{hashtags}").join(tags).replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n");
  return fillCaption(text, hook);
}

/** The caption for every platform at once. */
export function captionsFor(targets: Target[], templates: Templates, hook: string, app: Pick<AppProfile, "domain" | "hashtags">): Partial<Record<Target, string>> {
  return Object.fromEntries(targets.map((t) => [t, captionFor(t, templates[t], hook, app)]));
}

/** The address a post's link must be on, per platform. */
const HOSTS: Record<Target, RegExp> = {
  instagram: /(^|\.)instagram\.com$/,
  facebook: /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/,
  tiktok: /(^|\.)tiktok\.com$/,
  youtube: /(^|\.)(youtube\.com|youtu\.be)$/,
};
/** A post's page on that platform, not a profile or settings page (Codex 2026-11-26). Short links pass by host. */
const POST_PATHS: Record<Exclude<Target, "youtube">, (host: string, path: string, query: URLSearchParams) => boolean> = {
  instagram: (_h, p) => /^\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/[\w-]+\/?$/.test(p),
  facebook: (h, p, q) => (/(^|\.)fb\.watch$/.test(h) && /^\/[\w-]+\/?$/.test(p))
    || /^\/(?:reel|share\/[rvp])\/[\w-]+\/?$/.test(p) || /^\/[\w.-]+\/(?:videos|posts)\/(?:[\w.-]+\/)?[\w-]+\/?$/.test(p)
    || (/^\/watch\/?$/.test(p) && /^\d+$/.test(q.get("v") ?? "")) || (/^\/(?:permalink|story)\.php$/.test(p) && /^[\w-]+$/.test(q.get("story_fbid") ?? "")),
  tiktok: (h, p) => /^(vm|vt)\.tiktok\.com$/.test(h) || /^\/@[\w.-]+\/(?:video|photo)\/\d+\/?$/.test(p) || /^\/t\/[\w-]+\/?$/.test(p),
};
/** The post's link, cleaned (https, no spaces), or null when it isn't a link to that platform. */
export function postLink(t: Target, raw: string): string | null {
  let v = raw.trim();
  if (!v || v.length > 500) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!["http:", "https:"].includes(u.protocol) || !HOSTS[t].test(u.hostname.toLowerCase())) return null;
    // A post, not the site's home page; no login details or ports (Codex 2026-11-26).
    if (u.username || u.password || u.port || u.pathname.replace(/\/+$/, "") === "") return null;
    u.protocol = "https:";
    const link = u.toString();
    // YouTube: a link to one video; the others: a post's own page.
    if (t === "youtube") return youtubeId(link) ? link : null;
    return POST_PATHS[t](u.hostname.toLowerCase(), u.pathname, u.searchParams) ? link : null;
  } catch {
    return null;
  }
}
/** The YouTube video id in a Shorts, watch or youtu.be link; null for anything else. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
    const id = host === "youtu.be" ? u.pathname.slice(1) : host === "youtube.com" ? (u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1] ?? (u.pathname === "/watch" ? u.searchParams.get("v") : "") ?? "") : "";
    return /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Posted once every picked platform is marked posted. */
export const stateOf = (targets: Target[], result: Post["result"]): PostState => (targets.length && targets.every((t) => Boolean(result[t]?.postedAt)) ? "posted" : "scheduled");
/** Every platform's views added up; null when none is known. */
export function totalViews(post: Pick<Post, "targets" | "result">): number | null {
  const known = post.targets.map((t) => post.result[t]?.views).filter((v): v is number => typeof v === "number");
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

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

/** Why a create or edit is refused (null: fine). `now` in ms. Past times are fine: a video already posted can be logged. */
export function badPost(p: { at?: unknown; targets?: unknown; captions?: unknown }, now: number): string | null {
  const at = typeof p.at === "string" ? Date.parse(p.at) : NaN;
  if (!Number.isFinite(at)) return "Pick a time.";
  if (at > now + MAX_DAYS_AHEAD * 86_400_000) return `Pick a time within ${MAX_DAYS_AHEAD} days.`;
  if (at < now - MAX_DAYS_BACK * 86_400_000) return "Pick a time within the last year.";
  if (!Array.isArray(p.targets) || !p.targets.length || !p.targets.every((t) => TARGETS.includes(t)) || new Set(p.targets).size !== p.targets.length) return "Pick at least one platform.";
  const caps = p.captions as Record<string, unknown> | undefined;
  if (!caps || typeof caps !== "object") return "Add a caption.";
  for (const t of p.targets as Target[]) if (typeof caps[t] !== "string" || caps[t].length > CAPTION_MAX) return `The ${NAMES[t]} caption must be up to ${CAPTION_MAX} characters.`;
  return null;
}

/** "in 41m", "in 1h 50m", "in 2d 3h", "in 45s": the time left before a scheduled post goes out, short enough for one line. */
export function countdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `in ${d}d ${h}h`;
  if (h) return `in ${h}h ${m}m`;
  if (m) return `in ${m}m`;
  return `in ${s}s`;
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
 * comes on while the hook text is shown, read top to bottom (then left to right), on one line. Null when there are none.
 */
export function hookWords(texts: unknown, hook: { start?: unknown; end?: unknown } | null | undefined): string | null {
  if (!Array.isArray(texts)) return null;
  const list = texts as HookText[];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const hs = num(hook?.start) ?? 0, he = num(hook?.end);
  const ownHook = list.find((t) => t?.id === "hook");
  // Up to when a box counts as hook words: while the hook text itself is on screen (founder 2026-11-15: "this reel got
  // 1.6M views" came on at 2.6 s, after the hook text, still inside the 3.3 s hook clip, and must not be in the
  // caption). With no hook text box: the hook's trimmed length, else 3 s.
  const ownEnd = num(ownHook?.end);
  const length = ownEnd !== null && ownEnd > (num(ownHook?.start) ?? 0) ? ownEnd : he !== null && he > hs ? he - hs : 3;
  const words = list
    .filter((t) => typeof t?.text === "string" && t.text.trim() && (num(t.start) ?? 0) < length - 0.01)
    .sort((a, b) => (num(a.y) ?? 0) - (num(b.y) ?? 0) || (num(a.x) ?? 0) - (num(b.x) ?? 0))
    .map((t) => (t.text as string).replace(/\s+/g, " ").trim())
    .join(" ");
  return words || null;
}

export type Drafts = Record<string, Partial<Record<Target, string>>>;

/**
 * The captions on the review screen (founder 2026-11-15: "a final screen where they can edit their caption"): each
 * picked video's caption per platform, from the templates with its hook and the app filled in, keeping any edit made.
 */
export function draftCaptions(ids: string[], hookOf: (id: string) => string, targets: Target[], templates: Templates, app: Pick<AppProfile, "domain" | "hashtags">, kept: Drafts): Drafts {
  // Merged into what is kept: a video or platform unticked for a while keeps its edit for when it comes back (Codex
  // 2026-11-15). The screen, the length check and Save use only the current picks and platforms.
  const out: Drafts = { ...kept };
  for (const id of ids) out[id] = { ...kept[id], ...Object.fromEntries(targets.filter((t) => kept[id]?.[t] === undefined).map((t) => [t, captionFor(t, templates[t], hookOf(id), app)])) };
  return out;
}
