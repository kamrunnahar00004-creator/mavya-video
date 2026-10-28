import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { cloud, listAssets, listReferences, listRuns } from "@/lib/server/store";
import { coverLinks } from "@/lib/server/covers";
import type { Asset, Reference, Run } from "@/lib/types";

export const PAGE_SIZE = 24;
const ALL_REFERENCES = 2000;
const DATABASE_BATCH = 500;
type Kind = "runs" | "references" | "assets";
type Cursor = { at: string; id: string };
function cursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  if (raw.length > 512) throw Error("Invalid cursor");
  let value: Cursor;
  try { value = JSON.parse(Buffer.from(raw, "base64url").toString()); } catch { throw Error("Invalid cursor"); }
  if (!value || typeof value.at !== "string" || !/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(value.at) || !Number.isFinite(Date.parse(value.at)) || typeof value.id !== "string" || !/^[\w.-]{1,160}$/.test(value.id)) throw Error("Invalid cursor");
  return value;
}
const token = (at: string, id: string) => Buffer.from(JSON.stringify({ at, id })).toString("base64url");
/** Keyset continuation, including equal timestamps; each response and database read is bounded. */
export async function listPage(kind: Kind, who: string, request: Request) {
  const catalog = kind === "references" && new URL(request.url).searchParams.get("view") === "catalog";
  const compact = catalog || kind === "references" && new URL(request.url).searchParams.get("view") === "studio" && new URL(request.url).searchParams.get("all") === "1";
  const curatedOnly = catalog || kind === "references" && new URL(request.url).searchParams.get("scope") === "curated";
  const refSummary = compact || kind === "references" && new URL(request.url).searchParams.get("view") === "studio";
  const refKeys = ["title", "platform", "sourceUrl", "views", "mediaId", "mime", "analysis", "niche", "hookStyle", "thumbUrl", "author", "likes", "comments", "caption", "summary", "recipe", "postedAt", "pending", "review", "followers", "smallCover"];
  const compactKeys = ["title", "platform", "sourceUrl", "views", "mediaId", "mime", "author", "likes", "comments", "caption", "summary", "postedAt", "pending", "followers", "smallCover"];
  const compactSelect = "id,owner,created_at,refStyle:data->ai->>style,thumb:data->analysis->segments->0->>thumb,thumbFallback:data->>thumbUrl,reviewVerdict:data->review->>verdict," + compactKeys.map(k => k + ":data->" + k).join(",");
  const summary = kind === "runs" && new URL(request.url).searchParams.get("view") === "summary";
  const after = cursor(new URL(request.url).searchParams.get("cursor"));
  // The hook library loads whole (`all=1`) so its sort and style tabs cover every hook; still bounded.
  const size = kind === "references" && new URL(request.url).searchParams.get("all") === "1" ? ALL_REFERENCES : PAGE_SIZE;
  const table = kind === "references" ? "library" : kind;
  const idKey = kind === "assets" ? "media_id" : "id";
  let items: (Run | Reference | Asset)[];
  let next: string | null = null;
  if (cloud()) {
    // A hosted PostgREST max_rows cap must not silently turn all=1 into a truncated list.
    // Read with keyset batches, preserving owner filters on every query. Eight queries is a hard ceiling.
    type Row = {id: string; owner: Reference["owner"]; data: Run | Reference; media_id: string; name: string; kind: Asset["kind"]; created_at: string};
    const rows: Row[] = [];
    let batchAfter = after;
    let continuation = false;
    for (let batch = 0; batch < (size === ALL_REFERENCES ? 8 : 1) && rows.length < size; batch++) {
      let query = createSupabaseAdminClient().from(table).select(kind === "assets" ? "media_id,name,kind,created_at" : kind === "references" ? (compact ? compactSelect : refSummary ? "id,owner,created_at,refStyle:data->ai->style," + refKeys.map(k => k + ":data->" + k).join(",") : "id,owner,data,created_at") : summary ? "id,created_at,title:data->>title,updatedAt:data->>updatedAt,sourceRefId:data->>sourceRefId,hook:data->hook,demo:data->demo,product:data->product,sounds:data->sounds,sound:data->sound" : "id,data,created_at");
      query = kind === "references" ? curatedOnly ? query.eq("owner", "curated") : query.or(`owner.eq.curated,user_id.eq.${who}`) : query.eq("user_id", who);
      if (batchAfter) query = query.or(`created_at.lt.${batchAfter.at},and(created_at.eq.${batchAfter.at},${idKey}.lt.${batchAfter.id})`);
      const { data, error } = await query.order("created_at", { ascending: false }).order(idKey, { ascending: false }).limit(Math.min(size - rows.length, DATABASE_BATCH));
      if (error) throw error;
      const page = (data ?? []) as unknown as Row[];
      if (!page.length) { continuation = false; break; }
      rows.push(...page);
      const last = page.at(-1)!;
      batchAfter = { at: last.created_at, id: kind === "assets" ? last.media_id : last.id };
      continuation = size === ALL_REFERENCES || rows.length === size;
    }
    items = rows.map(r => kind === "assets" ? { mediaId: r.media_id, name: r.name, kind: r.kind, createdAt: r.created_at } : kind === "references" ? refSummary ? { ...r, id: r.id, owner: r.owner, createdAt: r.created_at, ai: (r as unknown as {refStyle?: string}).refStyle ? {style: (r as unknown as {refStyle: string}).refStyle} : undefined } as unknown as Reference : { ...r.data, id: r.id, owner: r.owner } as Reference : summary ? { ...(r as unknown as Run), createdAt: r.created_at } : r.data);
    if (continuation && rows.length) { const last = rows.at(-1)!; next = token(last.created_at, kind === "assets" ? last.media_id : last.id); }
  } else {
    const values = kind === "assets" ? await listAssets(who) : kind === "references" ? await listReferences(who) : await listRuns(who);
    const idOf = (v: Run | Reference | Asset) => "mediaId" in v && !("id" in v) ? v.mediaId : (v as Run | Reference).id;
    items = [...values].filter(v => !curatedOnly || ((v as Reference).owner ?? "curated") === "curated").sort((a,b) => b.createdAt.localeCompare(a.createdAt) || idOf(b).localeCompare(idOf(a))).filter(v => !after || v.createdAt < after.at || v.createdAt === after.at && idOf(v) < after.id).slice(0,size);
    if (items.length === size) { const last = items.at(-1)!; next = token(last.createdAt,idOf(last)); }
  }
  if (summary) items = items.map(value => {
    const run = value as Run;
    return { id: run.id, title: run.title, createdAt: run.createdAt, updatedAt: run.updatedAt, sourceRefId: run.sourceRefId,
      hook: { source: run.hook.source, describeReady: run.hook.describeReady, describe: run.hook.describe?.trim() ? "yes" : "", face: run.hook.face ? {} : null, generated: run.hook.generated ? {src: run.hook.generated.src} : undefined },
      demo: { clip: run.demo.clip, clips: run.demo.clips?.map(c => ({ id: c.id, mediaId: c.mediaId, src: c.src })) },
      product: run.product?.brief ? {brief: {}} : null, sounds: run.sounds?.length ? [{}] : run.sounds, sound: run.sound ? {} : null
    } as Run;
  });
  if (summary) {
    const ids = [...new Set(items.map(v => (v as Run).sourceRefId).filter((v): v is string => Boolean(v)))];
    const covers = new Map<string, string>();
    const imageURL = "/api/references/thumbnails?ids=" + ids.join(",");
    if (ids.length && cloud()) {
      const { data, error } = await createSupabaseAdminClient().from("library").select("id,thumb:data->analysis->segments->0->>thumb,fallback:data->>thumbUrl").in("id", ids).or(`owner.eq.curated,user_id.eq.${who}`);
      if (error) throw error;
      for (const row of (data ?? []) as unknown as {id:string;thumb:string|null;fallback:string|null}[]) {
        const thumb = row.thumb ?? row.fallback;
        if (thumb) covers.set(row.id, thumb.startsWith("data:") ? `${imageURL}#svgView(viewBox(0,${ids.indexOf(row.id) * 320},180,320))` : thumb);
      }
    } else if (ids.length) {
      for (const ref of await listReferences(who)) {
        const thumb = ref.analysis?.segments[0]?.thumb ?? ref.thumbUrl;
        if (thumb && ids.includes(ref.id)) covers.set(ref.id, thumb.startsWith("data:") ? `${imageURL}#svgView(viewBox(0,${ids.indexOf(ref.id) * 320},180,320))` : thumb);
      }
    }
    items = items.map(value => ({ ...value, cover: covers.get((value as Run).sourceRefId ?? "") }));
  }
  if (compact) items = items.map(value => {
    const ref = value as Reference & {thumb?: string; thumbFallback?: string; reviewVerdict?: "keep" | "drop"};
    return {
      id: ref.id, owner: cloud() ? ref.owner : ref.owner ?? "curated", createdAt: ref.createdAt, title: ref.title, platform: ref.platform, sourceUrl: ref.sourceUrl,
      views: ref.views, mediaId: ref.mediaId, mime: ref.mime, author: ref.author, likes: ref.likes, comments: ref.comments,
      caption: ref.caption, summary: ref.summary, postedAt: ref.postedAt, pending: ref.pending, followers: ref.followers,
      smallCover: ref.smallCover, ai: ref.ai, partial: true, analysis: null,
      thumbUrl: cloud() ? ref.thumb ?? ref.thumbFallback : ref.analysis?.segments[0]?.thumb ?? ref.thumbUrl,
      review: (cloud() ? ref.reviewVerdict : ref.review?.verdict) ? { verdict: cloud() ? ref.reviewVerdict! : ref.review!.verdict } : undefined,
    } as Reference;
  });
  let missingCovers: Reference[] = [];
  if (kind === "references" && cloud()) {
    // Small WebP cards straight from R2; references without one yet keep their thumbnail and get one in the background.
    const refs = items as Reference[];
    const links = await coverLinks(refs);
    items = refs.map(ref => links.has(ref.id) ? { ...ref, coverUrl: links.get(ref.id) } : ref);
    missingCovers = refs.filter(ref => !ref.smallCover);
  }
  if (kind === "references") {
  const version = catalog ? "&v=" + Date.now() : "";
  items = items.map((value, tile) => {
    const ref = value as Reference;
    const group = Math.floor(tile / PAGE_SIZE) * PAGE_SIZE;
    const imageURL = "/api/references/thumbnails?ids=" + items.slice(group, group + PAGE_SIZE).map(v => (v as Reference).id).join(",") + version;
    tile %= PAGE_SIZE;
    return { ...ref, thumbUrl: ref.thumbUrl?.startsWith("data:") ? `${imageURL}&segment=0#svgView(viewBox(0,${tile * 320},180,320))` : ref.thumbUrl, analysis: ref.analysis ? { ...ref.analysis, segments: ref.analysis.segments.map((seg, index) => ({ ...seg, thumb: seg.thumb?.startsWith("data:") ? `${imageURL}&segment=${index}#svgView(viewBox(0,${tile * 320},180,320))` : seg.thumb })) } : ref.analysis };
  });
  }
  return { items, next, missingCovers };
}
export function pageResponse(items: unknown[], next: string | null) {
  return Response.json(items, { headers: { "Cache-Control": "private, no-store", ...(next ? { "X-Next-Cursor": next } : {}) } });
}
export function listError(error: unknown) {
  return Response.json({ error: error instanceof Error && error.message === "Invalid cursor" ? "Invalid cursor" : "List is unavailable. Try again." }, { status: error instanceof Error && error.message === "Invalid cursor" ? 400 : 503 });
}
