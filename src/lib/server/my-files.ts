import "server-only";
import { readPhase } from "@/lib/server/read-timing";
import { cloud, listAssets, listReferences, listRuns } from "@/lib/server/store";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { demoPartsOf, soundSrcOf, type ExportSource, type FileSources, type GenSource } from "@/lib/my-files";
import type { Reference, Run } from "@/lib/types";

/** One read's batch; My files reads each source whole, batch by batch (no "Load more", nothing dropped). */
export const FILES_BATCH = 1000;
/** A runaway guard only: far beyond any real account (each batch is one bounded read). */
const MAX_BATCHES = 100;
type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
/** Every row of a query, newest first, read FILES_BATCH at a time. */
async function every<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data, error } = await page(i * FILES_BATCH, (i + 1) * FILES_BATCH - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < FILES_BATCH) return rows;
  }
  throw Error("My files is too large to read");
}

/** The fields a hook card needs, never the analysis (its frames are large); an inline frame is served by its link. */
const slimRef = (r: Reference & { thumb?: string | null }): Reference => {
  const thumb = r.thumb ?? r.analysis?.segments?.[0]?.thumb ?? r.thumbUrl;
  return {
    id: r.id, owner: r.owner, createdAt: r.createdAt, title: r.title, platform: r.platform, sourceUrl: r.sourceUrl, mediaId: r.mediaId, mime: r.mime,
    author: r.author, views: r.views, analysis: null, partial: true,
    thumbUrl: thumb?.startsWith("data:") ? `/api/references/thumbnails?ids=${r.id}&segment=0#svgView(viewBox(0,0,180,320))` : thumb ?? undefined,
  } as unknown as Reference;
};
const REF_FIELDS = "id,owner,created_at,title:data->>title,platform:data->>platform,sourceUrl:data->>sourceUrl,mediaId:data->>mediaId,mime:data->>mime,author:data->>author,views:data->views,thumb:data->analysis->segments->0->>thumb,thumbUrl:data->>thumbUrl";

/**
 * Everything My files lists, read in one go (src/lib/my-files.ts builds the tabs). The generations and export jobs
 * outlive a deleted video, so its generated hooks, demos, exports, hooks, characters and music stay listed.
 */
export async function fileSources(who: string): Promise<FileSources> {
  if (!cloud()) {
    const [runs, assets, refs] = await Promise.all([listRuns(who, true), listAssets(who), listReferences(who)]);
    const used = new Set(runs.flatMap((r) => [r.sourceRefId, ...(r.picked?.refs ?? []).map((p) => p.id)]));
    return { runs, generations: [], exports: [], assets, refs: refs.filter((r) => used.has(r.id) || (r.owner === "user" && r.mediaId)).map(slimRef) };
  }
  const db = createSupabaseAdminClient();
  const [runs, gens, jobs, assets, own] = await readPhase("sql", () => Promise.all([
    every((a, b) => db.from("runs").select("id,created_at,title:data->title,updatedAt:data->updatedAt,sourceRefId:data->sourceRefId,hook:data->hook,demo:data->demo,sounds:data->sounds,sound:data->sound,exports:data->exports,picked:data->picked,deletedAt:data->deletedAt").eq("user_id", who).order("created_at", { ascending: false }).order("id").range(a, b)),
    every((a, b) => db.from("generations").select("run_id,created_at,result,title:input->title,sourceRefId:input->sourceRefId,hook:input->hook").eq("user_id", who).eq("state", "done").order("created_at", { ascending: false }).order("id").range(a, b)),
    every((a, b) => db.from("export_jobs").select("run_id,created_at,result,segments:payload->spec->segments,sounds:payload->spec->sounds,demoTexts:payload->meta->demoTexts").eq("user_id", who).eq("state", "done").order("created_at", { ascending: false }).order("id").range(a, b)),
    every((a, b) => db.from("assets").select("media_id,name,kind,created_at").eq("user_id", who).order("created_at", { ascending: false }).order("media_id").range(a, b)),
    every((a, b) => db.from("library").select(REF_FIELDS).eq("user_id", who).eq("owner", "user").order("created_at", { ascending: false }).order("id").range(a, b)),
  ]));
  type RunRow = Omit<Run, "createdAt"> & { created_at: string };
  type GenRow = { run_id: string; created_at: string; result: GenSource["result"] | null; title: string | null; sourceRefId: string | null; hook: Run["hook"] | null };
  type JobRow = { run_id: string; created_at: string; result: { src?: string; seconds?: number; demo?: { src: string; seconds: number } } | null; segments: Parameters<typeof demoPartsOf>[0]; sounds: { url?: string }[] | null; demoTexts: string | null };
  const runList = (runs as unknown as RunRow[]).map(({ created_at, ...r }) => ({ ...r, createdAt: created_at, updatedAt: r.updatedAt ?? created_at } as Run));
  const generations: GenSource[] = (gens as unknown as GenRow[]).filter((g) => g.result?.src).map((g) => ({
    runId: g.run_id, at: g.result!.at ?? g.created_at, result: g.result!,
    // What the video was, without its other clips (Use brings the hook and character).
    from: { title: g.title ?? "Untitled video", sourceRefId: g.sourceRefId, hook: g.hook ? { ...g.hook, versions: undefined, generated: undefined } : ({ mode: "upload", text: "" } as Run["hook"]) },
  }));
  const exportList: ExportSource[] = (jobs as unknown as JobRow[]).filter((j) => j.result?.src).map((j) => ({
    runId: j.run_id, at: j.created_at, src: j.result!.src!, seconds: j.result!.seconds ?? 0, ...(j.result!.demo ? { demo: j.result!.demo } : {}),
    demoParts: demoPartsOf(j.segments ?? undefined), demoTexts: typeof j.demoTexts === "string" ? j.demoTexts : null,
    sounds: (j.sounds ?? []).map((s) => soundSrcOf(s.url ?? "")).filter((s): s is string => Boolean(s)),
  }));
  // Hooks: the user's own uploaded hooks, and every library hook a video or generation used.
  const ids = [...new Set([...runList.flatMap((r) => [r.sourceRefId, ...(r.picked?.refs ?? []).map((p) => p.id)]), ...generations.map((g) => g.from.sourceRefId)].filter((x): x is string => Boolean(x)))];
  // In slices, so no read is cut short however many hooks were used.
  const slices = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
  const used = (await readPhase("sql", () => Promise.all(slices.map((slice) => every((a, b) => db.from("library").select(REF_FIELDS).in("id", slice).or(`owner.eq.curated,user_id.eq.${who}`).order("id").range(a, b)))))).flat();
  type LibRow = Reference & { created_at: string; thumb: string | null };
  const refs = new Map<string, Reference>();
  for (const row of [...(own as unknown as LibRow[]), ...(used as unknown as LibRow[])]) refs.set(row.id, slimRef({ ...row, createdAt: row.created_at }));
  return {
    runs: runList, generations, exports: exportList,
    assets: ((assets as unknown) as { media_id: string; name: string; kind: "video" | "image" | "audio"; created_at: string }[]).map((a) => ({ mediaId: a.media_id, name: a.name, kind: a.kind, createdAt: a.created_at })),
    refs: [...refs.values()],
  };
}
