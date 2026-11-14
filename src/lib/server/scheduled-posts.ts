import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { signedGet } from "@/lib/server/r2";
import { fileSources } from "@/lib/server/my-files";
import { getFilePrefs, mediaAccess } from "@/lib/server/store";
import { buildFiles, mediaOf } from "@/lib/my-files";
import { badPost, DEFAULT_TEMPLATES, MAX_BATCH, rollUp, TARGETS, type Post, type Target, type TargetResult, type Templates } from "@/lib/scheduled-posts";

/**
 * Scheduled posts (founder 2026-11-15). Owner-only: SCHEDULED_POSTS_USERS lists the account ids that may use it, and
 * every post goes to the accounts in META_PAGE_TOKEN / META_PAGE_ID / IG_USER_ID (the founder's Summer Viola Page and
 * its Instagram). Opening it to everyone needs each user's own Meta connection and Meta's App Review first, never just
 * adding them here: their posts would go to the founder's accounts.
 */
export function schedulerAllowed(who: string | null): boolean {
  if (!who) return false;
  return (process.env.SCHEDULED_POSTS_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(who);
}

const GRAPH = "https://graph.facebook.com/v24.0";
const RUPLOAD = "https://rupload.facebook.com/video-upload/v24.0";
/** How long Meta may take to process one video before the post is marked failed. */
const PROCESS_LIMIT_MS = 30 * 60_000;
/** Network blips and Meta's "try again" errors are retried each minute, this many times, then the post fails. */
const MAX_ATTEMPTS = 8;

export class MetaError extends Error {
  constructor(message: string, readonly transient: boolean) { super(message); }
}

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
  /** Saves one network's progress before the next call, so a tick that dies never repeats a publish. */
  save: (target: Target, r: TargetResult) => Promise<void>;
};

/** One Graph API call; Meta's error message on failure (transient when Meta says so, or on a network error / 5xx). */
async function graph(ctx: Ctx, path: string, params: Record<string, string>, method: "GET" | "POST" = "GET", base = GRAPH, headers: Record<string, string> = {}) {
  const body = new URLSearchParams({ ...params, ...(base === GRAPH ? { access_token: ctx.creds.pageToken } : {}) });
  let res: Response;
  try {
    res = method === "GET"
      ? await ctx.fetch(`${base}/${path}?${body}`, { headers, cache: "no-store" })
      : await ctx.fetch(`${base}/${path}`, { method, headers: { ...(base === GRAPH ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...headers }, body: base === GRAPH ? body : undefined, cache: "no-store" });
  } catch {
    throw new MetaError("Couldn't reach Meta.", true);
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const err = json?.error as { message?: string; is_transient?: boolean; code?: number; error_user_msg?: string } | undefined;
  if (!res.ok || err) {
    const message = err?.error_user_msg || err?.message || `Meta answered ${res.status}.`;
    throw new MetaError(message, Boolean(err?.is_transient) || res.status >= 500 || err?.code === 2 || err?.code === 4);
  }
  return json ?? {};
}

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
      r = { state: "working", step: "processing", container: String(c.id), since: iso(ctx.now) };
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
      r = { state: "done", container: r.container, id: String(done.id) };
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
      r = { state: "working", step: "upload", video: String(s.video_id), since: iso(ctx.now) };
      await ctx.save("facebook", r);
      continue;
    }
    if (r.step === "upload") {
      await graph(ctx, r.video, {}, "POST", RUPLOAD, { Authorization: `OAuth ${ctx.creds.pageToken}`, file_url: await ctx.link(post.mediaId) });
      r = { ...r, step: "uploaded" };
      await ctx.save("facebook", r);
      continue;
    }
    const status = (await graph(ctx, r.video, { fields: "status,permalink_url" })) as { status?: { video_status?: string; uploading_phase?: { status?: string }; processing_phase?: { status?: string; error?: { message?: string } }; publishing_phase?: { status?: string } }; permalink_url?: string };
    const st = status.status ?? {};
    const failed = st.video_status === "error" || st.uploading_phase?.status === "error" || st.processing_phase?.status === "error";
    if (failed) return { ...r, state: "failed", error: `Facebook couldn't take the video${st.processing_phase?.error?.message ? `: ${st.processing_phase.error.message}` : "."}` };
    if (r.step === "uploaded" || r.step === "finishing") {
      // Already published by a tick that died after the call: don't publish twice.
      if (r.step === "finishing" && st.publishing_phase?.status && st.publishing_phase.status !== "not_started") { r = { ...r, step: "published" }; continue; }
      if (st.uploading_phase?.status !== "complete") return tooSlow(r, ctx.now) ? { ...r, state: "failed", error: "Facebook took over 30 minutes to receive the video." } : r;
      r = { ...r, step: "finishing" };
      await ctx.save("facebook", r);
      await graph(ctx, `${page}/video_reels`, { upload_phase: "finish", video_id: r.video!, video_state: "PUBLISHED", description: post.captions.facebook ?? "" }, "POST");
      r = { ...r, step: "published" };
      await ctx.save("facebook", r);
      continue;
    }
    if (r.step === "published") {
      const live = st.video_status === "ready" || st.publishing_phase?.status === "complete";
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
  const start: TargetResult = post.result[target] ?? { state: "waiting" };
  try {
    return { r: await (target === "instagram" ? stepInstagram : stepFacebook)(post, { ...start }, ctx) };
  } catch (e) {
    if (e instanceof MetaError && !e.transient) return { r: { ...start, state: "failed", error: e.message } };
    return { r: start, transient: e instanceof Error ? e.message : "Couldn't reach Meta." };
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

/**
 * Cron: posts whatever is due (up to 5 a minute, ~25 s at most). Each post is leased, so two ticks never post the same
 * one; a post waiting on Meta's processing is released and checked again next minute. True when it did work.
 */
export async function advancePosts(now = Date.now(), ctxFor: (save: Ctx["save"]) => Ctx | null = defaultCtx): Promise<boolean> {
  // Off (nobody on the list): no query at all, so the cron costs nothing extra.
  if (!(process.env.SCHEDULED_POSTS_USERS ?? "").trim()) return false;
  const at = iso(now);
  const { data, error } = await db().from("scheduled_posts").select("*")
    .or(`and(state.eq.scheduled,at.lte.${at}),and(state.eq.posting,or(lease_until.is.null,lease_until.lt.${at}))`)
    .order("at").limit(5);
  // Migration 0020 not applied yet: nothing to post (the page says so), not a failing cron every minute.
  if (error && (error.code === "PGRST205" || error.code === "42P01")) return false;
  if (error) throw error;
  let worked = false;
  for (const row of (data ?? []) as Row[]) {
    if (Date.now() - now > 25_000) break;
    const token = crypto.randomUUID();
    const claim = await db().from("scheduled_posts").update({ state: "posting", lease_token: token, lease_until: iso(Date.now() + 3 * 60_000), updated_at: iso(Date.now()) })
      .eq("id", row.id).in("state", ["scheduled", "posting"]).or(`lease_until.is.null,lease_until.lt.${iso(Date.now())}`).select("*");
    if (claim.error) throw claim.error;
    const claimed = claim.data?.[0] as Row | undefined;
    if (!claimed) continue;
    worked = true;
    const post = toPost(claimed);
    const saved: Post["result"] = { ...post.result };
    const save: Ctx["save"] = async (t, r) => {
      saved[t] = r;
      const { error: e } = await db().from("scheduled_posts").update({ result: saved, updated_at: iso(Date.now()) }).eq("id", post.id).eq("lease_token", token);
      if (e) throw new MetaError("Couldn't save progress.", true);
    };
    const ctx = ctxFor(save);
    const next = ctx
      ? await advancePost(post, claimed.attempts, ctx)
      : { state: "failed" as const, result: post.result, error: "Posting isn't set up on the server (Meta keys missing).", attempts: claimed.attempts };
    await db().from("scheduled_posts").update({ state: next.state, result: next.result, error: next.error, attempts: next.attempts, lease_token: null, lease_until: null, updated_at: iso(Date.now()) })
      .eq("id", post.id).eq("lease_token", token);
  }
  return worked;
}

function defaultCtx(save: Ctx["save"]): Ctx | null {
  const creds = metaCreds();
  if (!creds) return null;
  // Meta downloads the file within minutes; the link lasts 6 hours for slow processing.
  return { fetch, creds, now: Date.now(), save, link: (mediaId) => signedGet(`media/${mediaId}`, 6 * 3600) };
}

// The page's reads and writes. All are the signed-in owner's own rows only.

export type ExportChoice = { mediaId: string; title: string; hook: string; at: string; seconds: number; src: string };

/** The exported videos to pick from, newest first, with names given in My files and without the ones deleted there. */
export async function listExports(who: string): Promise<ExportChoice[]> {
  const [sources, prefs] = await Promise.all([fileSources(who), getFilePrefs(who)]);
  const hidden = new Set(prefs.hidden);
  return buildFiles(sources, null).exports
    .filter((e) => !hidden.has(e.key))
    .map((e) => ({ mediaId: mediaOf(e.value.src) ?? "", title: prefs.names[e.key] || e.runTitle || "Untitled video", hook: e.hookText ?? "", at: e.at, seconds: e.value.seconds, src: e.value.src }))
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

/** A failed post goes again now (or at its time, if that's later). Networks it already reached are not posted twice. */
export async function retryPost(who: string, id: string, now = Date.now()): Promise<{ error: string } | { post: Post }> {
  const { data: rows, error: readError } = await db().from("scheduled_posts").select("*").eq("id", id).eq("user_id", who).eq("state", "failed").limit(1);
  if (readError) throw readError;
  const row = rows?.[0] as Row | undefined;
  if (!row) return { error: "Only a failed post can be retried." };
  const result = Object.fromEntries(Object.entries(row.result ?? {}).filter(([, r]) => r?.state === "done"));
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
