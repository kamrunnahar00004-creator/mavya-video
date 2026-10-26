import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { cloud, listAssets, listReferences, listRuns } from "@/lib/server/store";
import type { Asset, Reference, Run } from "@/lib/types";

export const PAGE_SIZE = 24;
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
  const curatedOnly = kind === "references" && new URL(request.url).searchParams.get("scope") === "curated";
  const refSummary = kind === "references" && new URL(request.url).searchParams.get("view") === "studio";
  const refKeys = ["title", "platform", "sourceUrl", "views", "mediaId", "mime", "analysis", "niche", "hookStyle", "thumbUrl", "author", "likes", "comments", "caption", "summary", "recipe", "postedAt", "pending", "review", "followers"];
  const summary = kind === "runs" && new URL(request.url).searchParams.get("view") === "summary";
  const after = cursor(new URL(request.url).searchParams.get("cursor"));
  const table = kind === "references" ? "library" : kind;
  const idKey = kind === "assets" ? "media_id" : "id";
  let items: (Run | Reference | Asset)[];
  let next: string | null = null;
  if (cloud()) {
    let query = createSupabaseAdminClient().from(table).select(kind === "assets" ? "media_id,name,kind,created_at" : kind === "references" ? (refSummary ? "id,owner,created_at,refStyle:data->ai->style," + refKeys.map(k => k + ":data->" + k).join(",") : "id,owner,data,created_at") : summary ? "id,created_at,title:data->>title,updatedAt:data->>updatedAt,sourceRefId:data->>sourceRefId,hook:data->hook,demo:data->demo,product:data->product,sounds:data->sounds,sound:data->sound" : "id,data,created_at");
    query = kind === "references" ? curatedOnly ? query.eq("owner", "curated") : query.or(`owner.eq.curated,user_id.eq.${who}`) : query.eq("user_id", who);
    if (after) query = query.or(`created_at.lt.${after.at},and(created_at.eq.${after.at},${idKey}.lt.${after.id})`);
    const { data, error } = await query.order("created_at", { ascending: false }).order(idKey, { ascending: false }).limit(PAGE_SIZE);
    if (error) throw error;
    const rows = (data ?? []) as unknown as {id: string; owner: Reference["owner"]; data: Run | Reference; media_id: string; name: string; kind: Asset["kind"]; created_at: string}[];
    items = rows.map(r => kind === "assets" ? { mediaId: r.media_id, name: r.name, kind: r.kind, createdAt: r.created_at } : kind === "references" ? refSummary ? { ...r, id: r.id, owner: r.owner, createdAt: r.created_at, ai: (r as unknown as {refStyle?: string}).refStyle ? {style: (r as unknown as {refStyle: string}).refStyle} : undefined } as unknown as Reference : { ...r.data, id: r.id, owner: r.owner } as Reference : summary ? { ...(r as unknown as Run), createdAt: r.created_at } : r.data);
    if (rows.length === PAGE_SIZE) { const last = rows.at(-1)!; next = token(last.created_at, kind === "assets" ? last.media_id : last.id); }
  } else {
    const values = kind === "assets" ? await listAssets(who) : kind === "references" ? await listReferences(who) : await listRuns(who);
    const idOf = (v: Run | Reference | Asset) => "mediaId" in v && !("id" in v) ? v.mediaId : (v as Run | Reference).id;
    items = [...values].filter(v => !curatedOnly || (v as Reference).owner === "curated").sort((a,b) => b.createdAt.localeCompare(a.createdAt) || idOf(b).localeCompare(idOf(a))).filter(v => !after || v.createdAt < after.at || v.createdAt === after.at && idOf(v) < after.id).slice(0,PAGE_SIZE);
    if (items.length === PAGE_SIZE) { const last = items.at(-1)!; next = token(last.createdAt,idOf(last)); }
  }
  if (summary) items = items.map(value => {
    const run = value as Run;
    return { id: run.id, title: run.title, createdAt: run.createdAt, updatedAt: run.updatedAt, sourceRefId: run.sourceRefId,
      hook: { source: run.hook.source, describeReady: run.hook.describeReady, describe: run.hook.describe ? "yes" : "", face: run.hook.face ? {} : null, generated: run.hook.generated ? {src: run.hook.generated.src} : undefined },
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
  if (kind === "references") {
  const imageURL = "/api/references/thumbnails?ids=" + items.map(value => (value as Reference).id).join(",");
  items = items.map((value, tile) => {
    const ref = value as Reference;
    return { ...ref, thumbUrl: ref.thumbUrl?.startsWith("data:") ? `${imageURL}&segment=0#svgView(viewBox(0,${tile * 320},180,320))` : ref.thumbUrl, analysis: ref.analysis ? { ...ref.analysis, segments: ref.analysis.segments.map((seg, index) => ({ ...seg, thumb: seg.thumb?.startsWith("data:") ? `${imageURL}&segment=${index}#svgView(viewBox(0,${tile * 320},180,320))` : seg.thumb })) } : ref.analysis };
  });
  }
  return { items, next };
}
export function pageResponse(items: unknown[], next: string | null) {
  return Response.json(items, { headers: { "Cache-Control": "private, no-store", ...(next ? { "X-Next-Cursor": next } : {}) } });
}
export function listError(error: unknown) {
  return Response.json({ error: error instanceof Error && error.message === "Invalid cursor" ? "Invalid cursor" : "List is unavailable. Try again." }, { status: error instanceof Error && error.message === "Invalid cursor" ? 400 : 503 });
}
