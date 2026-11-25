import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fileSources } from "@/lib/server/my-files";
import { getFilePrefs, mediaAccess } from "@/lib/server/store";
import { buildFiles, mediaOf } from "@/lib/my-files";
import { badPost, CAPTION_MAX, DEFAULT_TEMPLATES, domainOf, hookWords, MAX_BATCH, postLink, stateOf, tagList, TARGETS, type AppProfile, type Post, type Target, type TargetResult, type Templates } from "@/lib/scheduled-posts";

/**
 * Content calendar (founder 2026-11-26): every signed-in user's plan of their exported videos per platform, with
 * captions to copy, the links of what they posted, and views typed in by hand (founder 2026-11-26: no automatic
 * views, YouTube included). Nothing is posted from here. The table is scheduled_posts (migration 0020).
 */

const iso = (ms: number) => new Date(ms).toISOString();
type Row = { id: string; user_id: string; media_id: string; title: string; hook: string; captions: Post["captions"]; targets: string[]; at: string; state: string; result: Record<string, unknown> | null; created_at: string; updated_at?: string };

/** A platform's saved record, only the fields this version uses (old auto-posting rows carry others). */
function cleanResult(r: unknown, rowAt: string): TargetResult | undefined {
  if (!r || typeof r !== "object") return undefined;
  const v = r as Record<string, unknown>;
  // Old auto-posted rows: each platform that reached "done" counts as posted at the row's time (Codex 2026-11-26:
  // a partly posted row kept the platforms that went out).
  const postedAt = typeof v.postedAt === "string" ? v.postedAt : v.state === "done" ? rowAt : undefined;
  const out: TargetResult = {};
  if (postedAt !== undefined) out.postedAt = postedAt;
  if (typeof v.url === "string") out.url = v.url;
  if (typeof v.views === "number" && Number.isFinite(v.views)) out.views = v.views;
  if (typeof v.viewsAt === "string") out.viewsAt = v.viewsAt;
  return Object.keys(out).length ? out : undefined;
}
const toPost = (r: Row): Post => {
  const targets = (r.targets ?? []).filter((t): t is Target => (TARGETS as string[]).includes(t));
  const result: Post["result"] = {};
  for (const t of targets) { const x = cleanResult(r.result?.[t], r.at); if (x) result[t] = x; }
  // Old auto-posted rows marked posted before postedAt existed keep their state.
  const legacyPosted = r.state === "posted" && targets.every((t) => !result[t]?.postedAt);
  if (legacyPosted) for (const t of targets) result[t] = { ...result[t], postedAt: r.at };
  return { id: r.id, mediaId: r.media_id, title: r.title, hook: r.hook, captions: r.captions ?? {}, targets, at: r.at, state: stateOf(targets, result), result, createdAt: r.created_at, ...(r.updated_at ? { updatedAt: r.updated_at } : {}) };
};
const db = () => createSupabaseAdminClient();

// The page's reads and writes. All are the signed-in owner's own rows only.

export type ExportChoice = { mediaId: string; title: string; hook: string; at: string; seconds: number; src: string };

/** The exported videos to pick from, newest first, with names given in My files and without the ones deleted there. */
export async function listExports(who: string): Promise<ExportChoice[]> {
  const [sources, prefs] = await Promise.all([fileSources(who), getFilePrefs(who)]);
  const hidden = new Set(prefs.hidden);
  const exports = buildFiles(sources, null).exports.filter((e) => !hidden.has(e.key));
  // Each video's own on-screen hook words (hookWords), read from its texts; the library hook's words only as a fallback.
  const ids = [...new Set(exports.map((e) => e.runId).filter((x): x is string => Boolean(x)))];
  const onScreen = new Map<string, string>();
  const hookless = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db().from("runs").select("id,texts:data->texts,hookStart:data->hook->start,hookEnd:data->hook->end,hookRemoved:data->hook->removed").eq("user_id", who).in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as { id: string; texts: unknown; hookStart: unknown; hookEnd: unknown; hookRemoved: unknown }[]) {
      // Hook deleted in the editor: the video's opening words are its first seconds' texts, not the old hook window.
      if (r.hookRemoved === true) hookless.add(r.id);
      const words = hookWords(r.texts, r.hookRemoved === true ? null : { start: r.hookStart, end: r.hookEnd });
      if (words) onScreen.set(r.id, words);
    }
  }
  return exports
    .map((e) => ({ mediaId: mediaOf(e.value.src) ?? "", title: prefs.names[e.key] || e.runTitle || "Untitled video", hook: (e.runId && onScreen.get(e.runId)) || (e.runId && hookless.has(e.runId) ? "" : e.hookText) || "", at: e.at, seconds: e.value.seconds, src: e.value.src }))
    .filter((e) => e.mediaId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export async function listPosts(who: string, from: string, to: string): Promise<Post[]> {
  const { data, error } = await db().from("scheduled_posts").select("*").eq("user_id", who).gte("at", from).lt("at", to).order("at").limit(1000);
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toPost);
}

export type NewPost = { mediaId: string; at: string; targets: Target[]; captions: Post["captions"]; title?: string; hook?: string };

/** Adds a batch; every video must be the user's own file. Returns the error to show, or the new posts. */
export async function createPosts(who: string, items: NewPost[], now = Date.now()): Promise<{ error: string } | { posts: Post[] }> {
  if (!Array.isArray(items) || !items.length || items.length > MAX_BATCH) return { error: `Pick 1 to ${MAX_BATCH} videos.` };
  const rows = [];
  for (const it of items) {
    const bad = badPost(it, now);
    if (bad) return { error: bad };
    if (typeof it.mediaId !== "string" || !(await mediaAccess(it.mediaId, who))) return { error: "One of the videos isn't available." };
    rows.push({
      id: crypto.randomUUID(), user_id: who, media_id: it.mediaId, title: String(it.title ?? "").slice(0, 200), hook: String(it.hook ?? "").slice(0, 500),
      captions: Object.fromEntries(it.targets.map((t) => [t, it.captions[t]])), targets: it.targets, at: iso(Date.parse(it.at)), state: "scheduled", result: {},
    });
  }
  const { data, error } = await db().from("scheduled_posts").insert(rows).select("*");
  if (error) throw error;
  return { posts: ((data ?? []) as Row[]).map(toPost) };
}

/** What a platform's "posted" box sends: posted or not, its link and views (all optional). */
export type Mark = { posted?: unknown; url?: unknown; views?: unknown };

/** One platform's record after an edit. Unticking "posted" clears it; a link must be a post on that platform; views are a whole number. */
export function markResult(t: Target, prev: TargetResult | undefined, mark: Mark, now: number): { error: string } | { r: TargetResult | undefined } {
  if (mark.posted !== true) return { r: undefined };
  const out: TargetResult = { postedAt: prev?.postedAt ?? iso(now) };
  const raw = typeof mark.url === "string" ? mark.url.trim() : "";
  if (raw) {
    const url = postLink(t, raw);
    if (!url) return { error: `That isn't a ${t === "youtube" ? "YouTube" : t === "tiktok" ? "TikTok" : t === "facebook" ? "Facebook" : "Instagram"} link.` };
    out.url = url;
  }
  if (mark.views !== undefined && mark.views !== null && mark.views !== "") {
    const n = typeof mark.views === "number" ? mark.views : Number(String(mark.views).replace(/[,\s]/g, ""));
    if (!Number.isInteger(n) || n < 0 || n > 1e11) return { error: "Views must be a whole number." };
    out.views = n;
    out.viewsAt = iso(now);
  }
  return { r: out };
}

/**
 * Edits a post: time, platforms, captions, and each platform's posted record (`marks`). Any post can change, posted
 * or not. Returns the post, or the error to show.
 */
export async function updatePost(who: string, id: string, patch: { at: string; targets: Target[]; captions: Post["captions"]; marks?: Partial<Record<Target, Mark>>; rev?: unknown }, now = Date.now()): Promise<{ error: string } | { post: Post }> {
  const { data: rows, error: readError } = await db().from("scheduled_posts").select("*").eq("id", id).eq("user_id", who).limit(1);
  if (readError) throw readError;
  const row = rows?.[0] as Row | undefined;
  if (!row) return { error: "This post was removed." };
  // Opened from an older copy (another tab saved since): refused, so neither edit is silently lost (Codex 2026-11-26).
  // The revision is required: an edit without it can't prove it saw the latest copy.
  if (row.updated_at && patch.rev !== row.updated_at) return { error: "This post changed. Open it again." };
  // The date window applies only when the time moves: a post over a year old still takes links, views and captions.
  const moved = Date.parse(patch.at) !== Date.parse(row.at);
  const bad = badPost(moved ? patch : { ...patch, at: iso(now) }, now);
  if (bad) return { error: bad };
  const before = toPost(row);
  const result: Post["result"] = {};
  for (const t of patch.targets) {
    const mark = patch.marks?.[t];
    if (!mark) { if (before.result[t]) result[t] = before.result[t]; continue; }
    const out = markResult(t, before.result[t], mark, now);
    if ("error" in out) return out;
    if (out.r) result[t] = out.r;
  }
  // Compare-and-swap on updated_at: another tab's save landing in between is never overwritten with a stale copy.
  let q = db().from("scheduled_posts")
    .update({ at: iso(Date.parse(patch.at)), targets: patch.targets, captions: Object.fromEntries(patch.targets.map((t) => [t, patch.captions[t]])), result, state: stateOf(patch.targets, result), updated_at: iso(Math.max(now, row.updated_at ? Date.parse(row.updated_at) + 1 : 0)) })
    .eq("id", id).eq("user_id", who);
  if (row.updated_at) q = q.eq("updated_at", row.updated_at);
  const { data, error } = await q.select("*");
  if (error) throw error;
  const saved = data?.[0] as Row | undefined;
  if (!saved) return { error: "This post just changed. Open it again." };
  return { post: toPost(saved) };
}

/**
 * Removes a post from the calendar (not from any platform), only the copy that was opened (`rev`, its updatedAt):
 * one changed in another tab since is kept (Codex 2026-11-26). "gone": already removed; "changed": not removed.
 */
export async function deletePost(who: string, id: string, rev?: unknown): Promise<"ok" | "gone" | "changed"> {
  let q = db().from("scheduled_posts").delete().eq("id", id).eq("user_id", who);
  if (typeof rev === "string") q = q.eq("updated_at", rev);
  const { data, error } = await q.select("id");
  if (error) throw error;
  if (data?.length) return "ok";
  const { data: still, error: e } = await db().from("scheduled_posts").select("id").eq("id", id).eq("user_id", who).limit(1);
  if (e) throw e;
  return still?.length ? "changed" : "gone";
}

/** Settings row: the four templates, and the app (`app`), in one jsonb (no migration needed). */
/** `rev` changes with every save of templates or app (not with the analyzer's run log), so a stale dialog is caught. */
type Settings = Partial<Templates> & { rev?: string; app?: Partial<AppProfile> & { runs?: string[]; pending?: string } };

async function readSettings(who: string): Promise<Settings> {
  const { data, error } = await db().from("scheduled_post_settings").select("templates").eq("user_id", who).maybeSingle<{ templates: Settings }>();
  if (error) throw error;
  return data?.templates ?? {};
}

/**
 * Changes the settings row with compare-and-swap on its updated_at (Codex 2026-11-26): templates, the app and the
 * analyzer's run log share it, so every writer re-reads and retries rather than writing back a stale copy.
 * `change` returns the new settings, or null to leave them. Returns what was written, or null.
 */
async function mutateSettings(who: string, change: (saved: Settings) => Settings | null): Promise<Settings | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await db().from("scheduled_post_settings").select("templates,updated_at").eq("user_id", who).maybeSingle<{ templates: Settings; updated_at: string }>();
    if (error) throw error;
    const next = change(data?.templates ?? {});
    if (!next) return null;
    const stamp = iso(Math.max(Date.now(), data ? Date.parse(data.updated_at) + 1 : 0));
    if (!data) {
      const { error: e } = await db().from("scheduled_post_settings").insert({ user_id: who, templates: next, updated_at: stamp });
      if (!e) return next;
      if (e.code !== "23505") throw e;
      continue;
    }
    const { data: hit, error: e } = await db().from("scheduled_post_settings").update({ templates: next, updated_at: stamp }).eq("user_id", who).eq("updated_at", data.updated_at).select("user_id");
    if (e) throw e;
    if (hit?.length) return next;
  }
  throw new Error("Settings are busy. Try again.");
}

export async function getTemplates(who: string): Promise<Templates> {
  const saved = await readSettings(who);
  return Object.fromEntries(TARGETS.map((t) => [t, typeof saved[t] === "string" ? saved[t] : DEFAULT_TEMPLATES[t]])) as Templates;
}

/** The app as saved (never the analyzer's run log). */
export function appOf(saved: Settings): AppProfile {
  const a = saved.app ?? {};
  return {
    url: typeof a.url === "string" ? a.url : "",
    domain: typeof a.domain === "string" ? a.domain : "",
    name: typeof a.name === "string" ? a.name : "",
    hashtags: tagList(a.hashtags),
    ...(typeof a.analyzedAt === "string" ? { analyzedAt: a.analyzedAt } : {}),
  };
}
export async function getApp(who: string): Promise<AppProfile> {
  return appOf(await readSettings(who));
}
/** Templates and app from one read of the row, so a save in between can't mix old and new (Codex 2026-11-26). */
export async function getSetup(who: string): Promise<{ templates: Templates; app: AppProfile; rev: string }> {
  const saved = await readSettings(who);
  return { templates: Object.fromEntries(TARGETS.map((t) => [t, typeof saved[t] === "string" ? saved[t] : DEFAULT_TEMPLATES[t]])) as Templates, app: appOf(saved), rev: saved.rev ?? "" };
}

/**
 * "Your app & captions" saved in one write (Codex 2026-11-26: two saves could half-succeed): the four templates and
 * the app typed by hand (free: no AI), both checked first. A typed save also cancels an analysis still running, so
 * its late answer can't overwrite what was just typed.
 */
export async function saveSetup(who: string, input: { templates?: unknown; url?: unknown; hashtags?: unknown; rev?: unknown }): Promise<{ error: string; stale?: true } | { templates: Templates; app: AppProfile; rev: string }> {
  const t = input.templates as Partial<Templates> | undefined;
  if (!t || typeof t !== "object" || !TARGETS.every((k) => typeof t[k] === "string" && t[k]!.length <= CAPTION_MAX)) return { error: `Each caption can be up to ${CAPTION_MAX} characters.` };
  const templates = Object.fromEntries(TARGETS.map((k) => [k, t[k]!])) as Templates;
  // The revision the dialog opened is required ("" for settings never saved), so nothing overwrites blind.
  if (typeof input.rev !== "string") return { error: "Close this and open it again." };
  const raw = typeof input.url === "string" ? input.url.trim().slice(0, 500) : "";
  const domain = domainOf(raw);
  if (raw && !domain) return { error: "Enter your app's website, e.g. yourapp.com" };
  let app: AppProfile = { url: raw, domain, name: "", hashtags: tagList(input.hashtags) };
  const rev = crypto.randomUUID();
  let stale = false;
  await mutateSettings(who, (saved) => {
    // Saved elsewhere since this dialog opened (another tab, an analysis): refused, not overwritten (Codex 2026-11-26).
    if ((saved.rev ?? "") !== input.rev) { stale = true; return null; }
    app = { ...appOf(saved), url: raw, domain, hashtags: tagList(input.hashtags) };
    return { ...saved, ...templates, rev, app: { ...saved.app, ...app, pending: undefined } };
  });
  return stale ? { error: "Your app or captions changed somewhere else. Close this and open it again.", stale: true } : { templates, app, rev };
}

/** Analyses a day per account (a small Gemini call each; the result is kept, so once is the norm). */
export const ANALYSES_PER_DAY = 5;

/**
 * Uses one of today's analyses and marks it the current one: the token to save its answer with, or null when today's
 * are used up. The log keeps the last day only.
 */
export async function claimAnalysis(who: string, now = Date.now(), rev?: string): Promise<string | null | "stale"> {
  const token = crypto.randomUUID();
  let stale = false;
  const done = await mutateSettings(who, (saved) => {
    // The dialog asking is out of date (saved elsewhere): it must reload first, or its next save would undo that.
    if (rev !== undefined && (saved.rev ?? "") !== rev) { stale = true; return null; }
    const runs = (saved.app?.runs ?? []).filter((t) => typeof t === "string" && now - Date.parse(t) < 86_400_000);
    return runs.length >= ANALYSES_PER_DAY ? null : { ...saved, app: { ...saved.app, runs: [...runs, iso(now)], pending: token } };
  });
  if (stale) return "stale";
  return done ? token : null;
}

/**
 * Saves what the analyzer found, only while its run is still the current one (Codex 2026-11-26): a newer analysis or
 * a typed save in the meantime wins. Null when it no longer applies.
 */
export async function saveAnalysis(who: string, token: string, url: string, found: { name: string; hashtags: string[] }, now = Date.now()): Promise<{ app: AppProfile; rev: string } | null> {
  const app: AppProfile = { url, domain: domainOf(url), name: found.name.slice(0, 80), hashtags: tagList(found.hashtags), analyzedAt: iso(now) };
  const rev = crypto.randomUUID();
  const done = await mutateSettings(who, (saved) => (saved.app?.pending === token ? { ...saved, rev, app: { ...saved.app, ...app, pending: undefined } } : null));
  return done ? { app, rev } : null;
}
