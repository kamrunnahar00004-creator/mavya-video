import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { signedGet } from "@/lib/server/r2";
import { fileSources } from "@/lib/server/my-files";
import { getFilePrefs, mediaAccess } from "@/lib/server/store";
import { buildFiles, mediaOf } from "@/lib/my-files";
import { schedulerAllowed, schedulerUsers } from "@/lib/posts-access";
import { badPost, hookWords, DEFAULT_TEMPLATES, MAX_BATCH, rollUp, TARGETS, type Post, type Target, type TargetResult, type Templates } from "@/lib/scheduled-posts";

/**
 * Scheduled posts (founder 2026-11-15). Owner-only: SCHEDULED_POSTS_USERS (src/lib/posts-access.ts) lists the account
 * ids that may use it, and every post goes to the accounts in META_PAGE_TOKEN / META_PAGE_ID / IG_USER_ID (the
 * founder's Summer Viola Page and its Instagram).
 */
export { schedulerAllowed };

const GRAPH = "https://graph.facebook.com/v24.0";
const RUPLOAD = "https://rupload.facebook.com/video-upload/v24.0";
/** How long Meta may take to process one video before the post is marked failed. */
const PROCESS_LIMIT_MS = 30 * 60_000;
/** Network blips and Meta's "try again" errors are retried each minute, this many times, then the post fails. */
const MAX_ATTEMPTS = 8;

export class MetaError extends Error {
  constructor(message: string, readonly transient: boolean) { super(message); }
}
/** Another cron run took this post over (its lease ran out): stop at once, make no further call to Meta. */
export class LostLease extends Error {}

/** One Meta call may take this long (the upload from a link longer); a post's whole pass stops at its deadline. */
const CALL_MS = 20_000, UPLOAD_MS = 60_000;

export type Creds = { pageId: string; pageToken: string; igUserId: string };
export function metaCreds(env: Record<string, string | undefined> = process.env): Creds | null {
  const pageId = env.META_PAGE_ID?.trim(), pageToken = env.META_PAGE_TOKEN?.trim(), igUserId = env.IG_USER_ID?.trim();
  return pageId && pageToken && igUserId ? { pageId, pageToken, igUserId } : null;
}

/** What posting needs from outside, so the steps are testable offline. */
export type Ctx = {
  fetch: typeof fetch;
  creds: Creds;
  now: number;
  /** A link Meta can download the video from. */
  link: (mediaId: string) => Promise<string>;
  /** Saves one network's progress before the next call, so a tick that dies never repeats a publish. Throws
   *  LostLease when this run no longer owns the post. */
  save: (target: Target, r: TargetResult) => Promise<void>;
  /** No Meta call starts after this (ms); unset: no limit. */
  deadline?: number;
};

/** One Graph API call; Meta's error message on failure (transient when Meta says so, or on a network error / 5xx). */
async function graph(ctx: Ctx, path: string, params: Record<string, string>, method: "GET" | "POST" = "GET", base = GRAPH, headers: Record<string, string> = {}) {
  const body = new URLSearchParams({ ...params, ...(base === GRAPH ? { access_token: ctx.creds.pageToken } : {}) });
  if (ctx.deadline !== undefined && Date.now() > ctx.deadline) throw new MetaError("Out of time this minute; it carries on next minute.", true);
  const signal = AbortSignal.timeout(base === RUPLOAD ? UPLOAD_MS : CALL_MS);
  let res: Response;
  try {
    res = method === "GET"
      ? await ctx.fetch(`${base}/${path}?${body}`, { headers, cache: "no-store", signal })
      : await ctx.fetch(`${base}/${path}`, { method, headers: { ...(base === GRAPH ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...headers }, body: base === GRAPH ? body : undefined, cache: "no-store", signal });
  } catch {
    // A timeout is "unknown", never "didn't happen": every publish is marked before its call and checked with Meta
    // before it is repeated.
    throw new MetaError("Couldn't reach Meta.", true);
  }
  // An answer that can't be read (cut off, timed out mid-body) is "unknown", never success (Codex 2026-11-15).
  const json = (await res.json().catch(() => undefined)) as Record<string, unknown> | null | undefined;
  if (json === undefined || json === null || typeof json !== "object") {
    if (!res.ok) throw new MetaError(`Meta answered ${res.status}.`, res.status >= 500);
    throw new MetaError("Meta's answer couldn't be read.", true);
  }
  const err = json?.error as { message?: string; is_transient?: boolean; code?: number; error_user_msg?: string } | undefined;
  if (!res.ok || err) {
    const message = err?.error_user_msg || err?.message || `Meta answered ${res.status}.`;
    throw new MetaError(message, Boolean(err?.is_transient) || res.status >= 500 || err?.code === 2 || err?.code === 4);
  }
  return json;
}

/** A field Meta must send back; missing means the outcome is unknown, so the step is not marked as done. */
function need(json: Record<string, unknown>, key: string): string {
  const v = json[key];
  if ((typeof v === "string" && v) || typeof v === "number") return String(v);
  throw new MetaError("Meta's answer was incomplete.", true);
}
const succeeded = (json: Record<string, unknown>) => { if (json.success !== true) throw new MetaError("Meta's answer was incomplete.", true); };

const iso = (ms: number) => new Date(ms).toISOString();
const tooSlow = (r: TargetResult, now: number) => r.since !== undefined && now - Date.parse(r.since) > PROCESS_LIMIT_MS;

/** Instagram Reels: container, wait for Meta to process it, publish, read the link. */
async function stepInstagram(post: Post, r: TargetResult, ctx: Ctx): Promise<TargetResult> {
  const ig = ctx.creds.igUserId;
  for (let hop = 0; hop < 4; hop++) {
    if (r.state === "done" || r.state === "failed") return r;
    if (!r.container) {
      const limit = await graph(ctx, `${ig}/content_publishing_limit`, { fields: "quota_usage,config" });
      const q = (limit.data as { quota_usage?: number; config?: { quota_total?: number } }[] | undefined)?.[0];
      if (q && typeof q.quota_usage === "number" && typeof q.config?.quota_total === "number" && q.quota_usage >= q.config.quota_total) {
        return { ...r, state: "waiting", note: "Instagram's daily limit is reached. It posts as soon as there's room." };
      }
      const c = await graph(ctx, `${ig}/media`, { media_type: "REELS", video_url: await ctx.link(post.mediaId), caption: post.captions.instagram ?? "", share_to_feed: "true" }, "POST");
      r = { state: "working", step: "processing", container: need(c, "id"), since: iso(ctx.now) };
      await ctx.save("instagram", r);
      continue;
    }
    if (r.step === "processing" || r.step === "publishing") {
      const s = await graph(ctx, r.container, { fields: "status_code,status" });
      const code = String(s.status_code ?? "");
      if (code === "PUBLISHED") return { state: "done", container: r.container };
      if (code === "ERROR" || code === "EXPIRED") return { ...r, state: "failed", error: `Instagram couldn't take the video: ${String(s.status ?? code)}` };
      if (code !== "FINISHED") return tooSlow(r, ctx.now) ? { ...r, state: "failed", error: "Instagram took over 30 minutes to process the video." } : r;
      // Marked before publishing: if this tick dies after Meta publishes, the next one sees PUBLISHED, not a repost.
      r = { ...r, step: "publishing" };
      await ctx.save("instagram", r);
      const done = await graph(ctx, `${ig}/media_publish`, { creation_id: r.container! }, "POST");
      r = { state: "done", container: r.container, id: need(done, "id") };
      await ctx.save("instagram", r);
      const link = await graph(ctx, r.id!, { fields: "permalink" }).catch(() => null);
      return typeof link?.permalink === "string" ? { ...r, url: link.permalink } : r;
    }
    return { ...r, state: "failed", error: "Unknown Instagram step." };
  }
  return r;
}

/** Facebook Page Reels: start, upload from the link, wait for the upload, publish, wait until it is live. */
async function stepFacebook(post: Post, r: TargetResult, ctx: Ctx): Promise<TargetResult> {
  const page = ctx.creds.pageId;
  for (let hop = 0; hop < 5; hop++) {
    if (r.state === "done" || r.state === "failed") return r;
    if (!r.video) {
      const s = await graph(ctx, `${page}/video_reels`, { upload_phase: "start" }, "POST");
      r = { state: "working", step: "upload", video: need(s, "video_id"), since: iso(ctx.now) };
      await ctx.save("facebook", r);
      continue;
    }
    if (r.step === "upload") {
      succeeded(await graph(ctx, r.video, {}, "POST", RUPLOAD, { Authorization: `OAuth ${ctx.creds.pageToken}`, file_url: await ctx.link(post.mediaId) }));
      r = { ...r, step: "uploaded" };
      await ctx.save("facebook", r);
      continue;
    }
    const status = (await graph(ctx, r.video, { fields: "status,permalink_url" })) as { status?: { video_status?: string; uploading_phase?: { status?: string }; processing_phase?: { status?: string; error?: { message?: string } }; publishing_phase?: { status?: string } }; permalink_url?: string };
    const st = status.status ?? {};
    // Any phase in error fails it, publishing included (Codex 2026-11-15: a publishing error with video "ready" showed
    // as posted).
    const failed = st.video_status === "error" || st.uploading_phase?.status === "error" || st.processing_phase?.status === "error" || st.publishing_phase?.status === "error";
    if (failed) return { ...r, state: "failed", error: `Facebook couldn't ${st.publishing_phase?.status === "error" ? "publish" : "take"} the video${st.processing_phase?.error?.message ? `: ${st.processing_phase.error.message}` : "."}` };
    if (r.step === "uploaded" || r.step === "finishing") {
      // Already published by a tick that died after the call: don't publish twice.
      if (r.step === "finishing" && (st.publishing_phase?.status === "in_progress" || st.publishing_phase?.status === "complete")) { r = { ...r, step: "published" }; continue; }
      if (st.uploading_phase?.status !== "complete") return tooSlow(r, ctx.now) ? { ...r, state: "failed", error: "Facebook took over 30 minutes to receive the video." } : r;
      r = { ...r, step: "finishing" };
      await ctx.save("facebook", r);
      succeeded(await graph(ctx, `${page}/video_reels`, { upload_phase: "finish", video_id: r.video!, video_state: "PUBLISHED", description: post.captions.facebook ?? "" }, "POST"));
      r = { ...r, step: "published" };
      await ctx.save("facebook", r);
      continue;
    }
    if (r.step === "published") {
      // Live only on Meta's word that publishing completed ("ready" alone only when Meta reports no publishing phase).
      const live = st.publishing_phase?.status === "complete" || (st.publishing_phase === undefined && st.video_status === "ready");
      const url = status.permalink_url ? (status.permalink_url.startsWith("http") ? status.permalink_url : `https://www.facebook.com${status.permalink_url}`) : undefined;
      if (live) return { state: "done", video: r.video, id: r.video, ...(url ? { url } : {}) };
      return tooSlow(r, ctx.now) ? { ...r, state: "failed", error: "Facebook took over 30 minutes to publish the video." } : r;
    }
    return { ...r, state: "failed", error: "Unknown Facebook step." };
  }
  return r;
}

/** Moves one network as far as it can go now. Meta's refusals fail it; network blips leave it for the next minute. */
export async function stepTarget(target: Target, post: Post, ctx: Ctx): Promise<{ r: TargetResult; transient?: string }> {
  // The newest saved progress, never the starting point: an error after a step was saved keeps that step (its
  // container, video, publish marker), so the next pass checks it instead of starting over (Codex 2026-11-15).
  let latest: TargetResult = post.result[target] ?? { state: "waiting" };
  const tracked: Ctx = { ...ctx, save: async (t, r) => { latest = r; await ctx.save(t, r); } };
  try {
    return { r: await (target === "instagram" ? stepInstagram : stepFacebook)(post, { ...latest }, tracked) };
  } catch (e) {
    if (e instanceof LostLease) throw e;
    if (e instanceof MetaError && !e.transient) return { r: { ...latest, state: "failed", error: e.message } };
    return { r: latest, transient: e instanceof Error ? e.message : "Couldn't reach Meta." };
  }
}

/**
 * One pass over one claimed post: every network still going moves on, then the post's state follows. Returns the
 * new state, result and error (pure apart from ctx, so the cron and the checks share it).
 */
export async function advancePost(post: Post, attempts: number, ctx: Ctx): Promise<{ state: Post["state"]; result: Post["result"]; error: string | null; attempts: number }> {
  const result: Post["result"] = { ...post.result };
  let transient: string | null = null;
  for (const t of post.targets) {
    const { r, transient: blip } = await stepTarget(t, { ...post, result }, ctx);
    result[t] = r;
    if (blip) transient = blip;
  }
  let state = rollUp(post.targets, result);
  let tries = attempts;
  if (transient && state === "posting") {
    tries += 1;
    if (tries >= MAX_ATTEMPTS) {
      for (const t of post.targets) if (result[t]?.state !== "done") result[t] = { ...(result[t] ?? { state: "waiting" }), state: "failed", error: transient };
      state = "failed";
    }
  }
  const errors = post.targets.map((t) => result[t]?.state === "failed" ? `${t === "instagram" ? "Instagram" : "Facebook"}: ${result[t]?.error ?? "failed"}` : null).filter(Boolean);
  return { state, result, error: state === "failed" ? errors.join(" · ") || "Posting failed." : null, attempts: tries };
}

type Row = { id: string; user_id: string; media_id: string; title: string; hook: string; captions: Post["captions"]; targets: Target[]; at: string; state: Post["state"]; result: Post["result"]; attempts: number; error: string | null; created_at: string; lease_token: string | null };
const toPost = (r: Row): Post => ({ id: r.id, mediaId: r.media_id, title: r.title, hook: r.hook, captions: r.captions ?? {}, targets: r.targets, at: r.at, state: r.state, result: r.result ?? {}, error: r.error, createdAt: r.created_at });
const db = () => createSupabaseAdminClient();

/** A claim lasts longer than a post's whole pass can (its deadline), so two runs never work on one post. */
const LEASE_MS = 5 * 60_000, POST_MS = 200_000, START_MS = 30_000;
/** Due now: scheduled with its time come, or mid-posting with no live claim. The read and the claim both use it, so a
 *  post moved later between them is not taken (Codex 2026-11-15). */
export const due = (at: string) => `and(state.eq.scheduled,at.lte.${at}),and(state.eq.posting,or(lease_until.is.null,lease_until.lt.${at}))`;

/**
 * Cron (/api/internal/posts, its own job): posts whatever is due for the allowed accounts, up to 5 a minute. Each post
 * is leased; every save checks the lease, so a run that lost it stops before calling Meta again. A post waiting on
 * Meta's processing is released and checked again next minute. True when it did work.
 */
export async function advancePosts(now = Date.now(), ctxFor: (save: Ctx["save"], deadline: number) => Ctx | null = defaultCtx, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  // Off (nobody on the list): no query at all. Only listed accounts' posts are ever posted (Codex 2026-11-15).
  const users = schedulerUsers(env);
  if (!users.length) return false;
  const at = iso(now);
  const { data, error } = await db().from("scheduled_posts").select("*").in("user_id", users)
    .or(due(at))
    .order("at").limit(5);
  // Migration 0020 not applied yet: nothing to post (the page says so), not a failing cron every minute.
  if (error && (error.code === "PGRST205" || error.code === "42P01")) return false;
  if (error) throw error;
  let worked = false;
  for (const row of (data ?? []) as Row[]) {
    if (Date.now() - now > START_MS) break;
    const token = crypto.randomUUID();
    const claim = await db().from("scheduled_posts").update({ state: "posting", lease_token: token, lease_until: iso(Date.now() + LEASE_MS), updated_at: iso(Date.now()) })
      .eq("id", row.id).in("user_id", users).or(due(iso(Date.now()))).select("*");
    if (claim.error) throw claim.error;
    const claimed = claim.data?.[0] as Row | undefined;
    if (!claimed) continue;
    worked = true;
    const post = toPost(claimed);
    const saved: Post["result"] = { ...post.result };
    const save: Ctx["save"] = async (t, r) => {
      const next = { ...saved, [t]: r };
      const { data: hit, error: e } = await db().from("scheduled_posts").update({ result: next, updated_at: iso(Date.now()) }).eq("id", post.id).eq("lease_token", token).select("id");
      if (e) throw new MetaError("Couldn't save progress.", true);
      if (!hit?.length) throw new LostLease("lost the post's lease");
      saved[t] = r;
    };
    const ctx = ctxFor(save, Date.now() + POST_MS);
    try {
      const next = ctx
        ? await advancePost(post, claimed.attempts, ctx)
        : { state: "failed" as const, result: post.result, error: "Posting isn't set up on the server (Meta keys missing).", attempts: claimed.attempts };
      await db().from("scheduled_posts").update({ state: next.state, result: next.result, error: next.error, attempts: next.attempts, lease_token: null, lease_until: null, updated_at: iso(Date.now()) })
        .eq("id", post.id).eq("lease_token", token);
    } catch (e) {
      if (!(e instanceof LostLease)) throw e;
      // Another run owns it now; it carries on from the saved progress.
    }
  }
  return worked;
}

function defaultCtx(save: Ctx["save"], deadline: number): Ctx | null {
  const creds = metaCreds();
  if (!creds) return null;
  // Meta downloads the file within minutes; the link lasts 6 hours for slow processing.
  return { fetch, creds, now: Date.now(), save, deadline, link: (mediaId) => signedGet(`media/${mediaId}`, 6 * 3600) };
}

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
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db().from("runs").select("id,texts:data->texts,hookStart:data->hook->start,hookEnd:data->hook->end").eq("user_id", who).in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as { id: string; texts: unknown; hookStart: unknown; hookEnd: unknown }[]) {
      const words = hookWords(r.texts, { start: r.hookStart, end: r.hookEnd });
      if (words) onScreen.set(r.id, words);
    }
  }
  return exports
    .map((e) => ({ mediaId: mediaOf(e.value.src) ?? "", title: prefs.names[e.key] || e.runTitle || "Untitled video", hook: (e.runId && onScreen.get(e.runId)) || e.hookText || "", at: e.at, seconds: e.value.seconds, src: e.value.src }))
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
    if (Date.parse(it.at) < now - 60_000) return { error: "Pick a time that hasn't passed." };
    if (typeof it.mediaId !== "string" || !(await mediaAccess(it.mediaId, who))) return { error: "One of the videos isn't available." };
    rows.push({
      id: crypto.randomUUID(), user_id: who, media_id: it.mediaId, title: String(it.title ?? "").slice(0, 200), hook: String(it.hook ?? "").slice(0, 500),
      captions: Object.fromEntries(it.targets.map((t) => [t, it.captions[t]])), targets: it.targets, at: iso(Date.parse(it.at)),
    });
  }
  const { data, error } = await db().from("scheduled_posts").insert(rows).select("*");
  if (error) throw error;
  return { posts: ((data ?? []) as Row[]).map(toPost) };
}

/** Changes a post that hasn't started: time, networks, captions. */
export async function updatePost(who: string, id: string, patch: { at: string; targets: Target[]; captions: Post["captions"] }, now = Date.now()): Promise<{ error: string } | { post: Post }> {
  const bad = badPost(patch, now);
  if (bad) return { error: bad };
  const { data, error } = await db().from("scheduled_posts")
    .update({ at: iso(Date.parse(patch.at)), targets: patch.targets, captions: Object.fromEntries(patch.targets.map((t) => [t, patch.captions[t]])), updated_at: iso(now) })
    .eq("id", id).eq("user_id", who).eq("state", "scheduled").select("*");
  if (error) throw error;
  const row = data?.[0] as Row | undefined;
  return row ? { post: toPost(row) } : { error: "This post has already started posting." };
}

/**
 * What a retry keeps (Codex 2026-11-15): networks already done, and any attempt that may have gone out (Instagram
 * publish marked, Facebook finish marked or published), set going again so the next pass asks Meta what happened
 * before doing anything. Only attempts that surely never went out start fresh.
 */
export function retryResult(result: Post["result"]): Post["result"] {
  const out: Post["result"] = {};
  for (const t of TARGETS) {
    const r = result[t];
    if (!r) continue;
    if (r.state === "done") out[t] = r;
    else if ((t === "instagram" && r.container && r.step === "publishing") || (t === "facebook" && r.video && (r.step === "finishing" || r.step === "published"))) {
      out[t] = { ...r, state: "working", error: undefined, since: iso(Date.now()) };
    }
  }
  return out;
}

/** A failed post goes again now (or at its time, if that's later). Networks it already reached are not posted twice. */
export async function retryPost(who: string, id: string, now = Date.now()): Promise<{ error: string } | { post: Post }> {
  const { data: rows, error: readError } = await db().from("scheduled_posts").select("*").eq("id", id).eq("user_id", who).eq("state", "failed").limit(1);
  if (readError) throw readError;
  const row = rows?.[0] as Row | undefined;
  if (!row) return { error: "Only a failed post can be retried." };
  const result = retryResult(row.result ?? {});
  const { data, error } = await db().from("scheduled_posts")
    .update({ state: "scheduled", result, error: null, attempts: 0, at: iso(Math.max(now, Date.parse(row.at))), updated_at: iso(now) })
    .eq("id", id).eq("user_id", who).eq("state", "failed").select("*");
  if (error) throw error;
  return data?.[0] ? { post: toPost(data[0] as Row) } : { error: "Only a failed post can be retried." };
}

/** Removes a post from the calendar (not from Instagram or Facebook). Never while it is being posted. */
export async function deletePost(who: string, id: string): Promise<boolean> {
  const { data, error } = await db().from("scheduled_posts").delete().eq("id", id).eq("user_id", who).neq("state", "posting").select("id");
  if (error) throw error;
  return Boolean(data?.length);
}

export async function getTemplates(who: string): Promise<Templates> {
  const { data, error } = await db().from("scheduled_post_settings").select("templates").eq("user_id", who).maybeSingle<{ templates: Partial<Templates> }>();
  if (error) throw error;
  const saved = data?.templates ?? {};
  return Object.fromEntries(TARGETS.map((t) => [t, typeof saved[t] === "string" ? saved[t] : DEFAULT_TEMPLATES[t]])) as Templates;
}

export async function setTemplates(who: string, templates: Templates): Promise<void> {
  const { error } = await db().from("scheduled_post_settings").upsert({ user_id: who, templates, updated_at: new Date().toISOString() });
  if (error) throw error;
}
