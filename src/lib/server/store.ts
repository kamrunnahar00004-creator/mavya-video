import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { r2Enabled, downloadTo, objectSize, putObject, signedGet, signedPut } from "@/lib/server/r2";
import { authEnabled, createSupabaseAdminClient } from "@/lib/supabase/server";
import type { Asset, Reference, Run } from "@/lib/types";

/**
 * Every read and write of records and files goes through here.
 *
 * Cloud (Supabase keys + R2 keys set): records in Supabase (supabase/migrations/0002), one user's runs, uploads and
 * hooks visible only to that user; the curated library shared by everyone. Files in R2 (src/lib/server/r2.ts).
 * Local (no keys): one person, records in .data/db.json, files in .data/media, as in the prototype.
 *
 * `who` is the signed-in user's id ("local" without accounts). Routes get it from currentUser().
 */
export const cloud = () => authEnabled() && r2Enabled();

const DATA_DIR = path.join(process.cwd(), ".data");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};
export const extFor = (mime: string): string | null => EXT_BY_MIME[mime] ?? null;
const mimeOfId = (mediaId: string) => Object.entries(EXT_BY_MIME).find(([, e]) => e === mediaId.split(".").pop())?.[0] ?? "application/octet-stream";

function kindOf(mime: string): Asset["kind"] {
  return mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "video";
}

export function isMediaId(id: string): boolean {
  return /^[0-9a-f-]{36}\.(mp4|mov|webm|jpg|png|mp3|m4a|aac|wav)$/.test(id);
}
const newMediaId = (mime: string) => {
  const ext = extFor(mime);
  if (!ext) throw new Error("Unsupported file type");
  return `${randomUUID()}.${ext}`;
};
const mediaKey = (mediaId: string) => `media/${mediaId}`;
const newest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
const db = () => createSupabaseAdminClient();

/* ---------- Local file database (no keys) ---------- */

type LocalDb = { references: Reference[]; runs: Run[]; assets: Asset[] };
let cached: { stamp: string; db: LocalDb } | null = null;
async function readDb(): Promise<LocalDb> {
  try {
    const info = await stat(DB_FILE);
    const stamp = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    if (cached?.stamp === stamp) return cached.db;
    const data = JSON.parse(await readFile(DB_FILE, "utf8")) as Partial<LocalDb>;
    if (!Array.isArray(data.references) || !Array.isArray(data.runs) || !Array.isArray(data.assets)) throw new Error("Invalid local database");
    const result = { references: data.references, runs: data.runs, assets: data.assets };
    cached = { stamp, db: result };
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { references: [], runs: [], assets: [] };
    throw error;
  }
}

let writing: Promise<void> = Promise.resolve();
async function writeDb(update: (db: LocalDb) => void): Promise<void> {
  // Serialize writes so two requests never interleave on db.json.
  const operation = writing.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    // Never mutate the cached snapshot before the atomic replacement succeeds.
    const data = structuredClone(await readDb());
    update(data);
    const tmp = `${DB_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, DB_FILE);
    cached = null;
  });
  writing = operation.catch(() => undefined);
  await operation;
}

/* ---------- References (the hook library) ---------- */

type LibraryRow = { id: string; owner: "curated" | "user"; user_id: string | null; data: Reference; created_at: string };
const fromRow = (r: LibraryRow): Reference => ({ ...r.data, id: r.id, owner: r.owner });

/** The curated library plus this user's own uploaded or pasted hooks. */
export async function listReferences(who: string): Promise<Reference[]> {
  if (!cloud()) return [...(await readDb()).references].sort(newest);
  const { data, error } = await db().from("library").select("*").or(`owner.eq.curated,user_id.eq.${who}`).order("created_at", { ascending: false }).limit(5000);
  if (error) throw error;
  return (data as LibraryRow[]).map(fromRow);
}

export async function getReference(id: string, who: string): Promise<Reference | null> {
  if (!cloud()) return (await readDb()).references.find((r) => r.id === id) ?? null;
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data, error } = await db().from("library").select("*").eq("id", id).maybeSingle<LibraryRow>();
  if (error) throw error;
  if (!data || (data.owner === "user" && data.user_id !== who)) return null;
  return fromRow(data);
}

export async function createReference(input: Omit<Reference, "id" | "createdAt" | "analysis">, who: string): Promise<Reference> {
  const ref: Reference = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), analysis: null };
  if (!cloud()) {
    await writeDb((d) => d.references.push(ref));
    return ref;
  }
  const owner = ref.owner === "curated" ? "curated" : "user";
  const { error } = await db().from("library").insert({ id: ref.id, owner, user_id: owner === "user" ? who : null, data: ref, created_at: ref.createdAt });
  if (error) throw error;
  return ref;
}

export async function updateReference(id: string, patch: Partial<Pick<Reference, "title" | "platform" | "sourceUrl" | "views" | "analysis" | "pending" | "review">>, who: string): Promise<Reference | null> {
  if (!cloud()) {
    let updated: Reference | null = null;
    await writeDb((d) => {
      const i = d.references.findIndex((r) => r.id === id);
      if (i >= 0) {
        d.references[i] = { ...d.references[i], ...patch };
        updated = d.references[i];
      }
    });
    return updated;
  }
  const current = await getReference(id, who);
  if (!current) return null;
  const next = { ...current, ...patch };
  const { error } = await db().from("library").update({ data: next }).eq("id", id);
  if (error) throw error;
  return next;
}

export async function deleteReference(id: string, who: string): Promise<void> {
  if (!cloud()) {
    let mediaId: string | null = null;
    await writeDb((d) => {
      mediaId = d.references.find((r) => r.id === id)?.mediaId ?? null;
      d.references = d.references.filter((r) => r.id !== id);
    });
    if (mediaId) await deleteMediaFile(mediaId);
    return;
  }
  const ref = await getReference(id, who);
  if (!ref) return;
  const { error } = await db().from("library").delete().eq("id", id);
  if (error) throw error;
  if (ref.mediaId) await deleteMediaFile(ref.mediaId);
}

/* ---------- Runs ---------- */

type RunRow = { id: string; user_id: string; data: Run; created_at: string; updated_at: string };

export async function listRuns(who: string): Promise<Run[]> {
  if (!cloud()) return [...(await readDb()).runs].sort(newest);
  const { data, error } = await db().from("runs").select("data").eq("user_id", who).order("created_at", { ascending: false }).limit(1000);
  if (error) throw error;
  return (data as Pick<RunRow, "data">[]).map((r) => r.data);
}

export async function getRun(id: string, who: string): Promise<Run | null> {
  if (!cloud()) return (await readDb()).runs.find((r) => r.id === id) ?? null;
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data, error } = await db().from("runs").select("data").eq("id", id).eq("user_id", who).maybeSingle<Pick<RunRow, "data">>();
  if (error) throw error;
  return data?.data ?? null;
}

/**
 * The product the seller set most recently (link, brief, notes, photos), carried into every new video until they
 * change it. "Most recently" = the newest product.at; a carried copy gets a fresh one, so later edits there win.
 */
async function lastProduct(who: string): Promise<Pick<Run, "product" | "productNotes" | "productScreens"> | null> {
  type Carried = { product: Run["product"]; notes?: string | null; screens?: string[] | null };
  let found: Carried | null = null;
  if (!cloud()) {
    const r = (await readDb()).runs.filter((x) => x.product?.brief).sort((a, b) => (b.product!.at > a.product!.at ? 1 : -1))[0];
    found = r ? { product: r.product, notes: r.productNotes, screens: r.productScreens } : null;
  } else {
    const { data, error } = await db().from("runs").select("product:data->product, notes:data->productNotes, screens:data->productScreens")
      .eq("user_id", who).not("data->product->>at", "is", null).order("data->product->>at", { ascending: false }).limit(1).maybeSingle<Carried>();
    if (error) console.error("last product", error);
    found = data ?? null;
  }
  if (!found?.product?.brief) return null;
  return {
    product: { ...found.product, at: new Date().toISOString() },
    ...(typeof found.notes === "string" && found.notes ? { productNotes: found.notes } : {}),
    ...(Array.isArray(found.screens) && found.screens.length ? { productScreens: found.screens } : {}),
  };
}

export async function createRun(who: string, requestedId?: string, source?: Reference): Promise<Run> {
  const now = new Date().toISOString();
  const carried = await lastProduct(who).catch(() => null);
  const run: Run = {
    ...carried,
    id: requestedId ?? randomUUID(),
    title: source?.title ?? "Untitled run",
    createdAt: now,
    updatedAt: now,
    sourceRefId: source?.id ?? null,
    hook: { mode: "upload", text: "How is this tool even legal?", clip: null, avatarIndex: null, variationIndex: null, ...(source ? { source: "library" as const, start: source.analysis?.segments.find(s => s.role === "hook")?.start ?? 0, end: source.analysis?.segments.find(s => s.role === "hook")?.end ?? 3 } : {}) },
    demo: { clip: null, frame: "laptop" },
    project: null,
  };
  if (!cloud()) {
    let result = run;
    await writeDb((d) => { const existing = d.runs.find(r => r.id === run.id); if (existing) result = existing; else d.runs.push(run); });
    return result;
  }
  const { error } = await db().from("runs").upsert({ id: run.id, user_id: who, data: run, created_at: now, updated_at: now }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
  const stored = await getRun(run.id, who);
  if (!stored) throw Error("Video identity conflict");
  return stored;
}

// Cloud merges sections under the database row lock, across all server instances.
export async function updateRun(id: string, patch: Partial<Omit<Run, "id" | "createdAt">>, who: string): Promise<Run | null> {
  if (!cloud()) {
    let updated: Run | null = null;
    await writeDb((d) => {
      const i = d.runs.findIndex((r) => r.id === id);
      if (i >= 0) {
        d.runs[i] = { ...d.runs[i], ...patch, updatedAt: new Date().toISOString() };
        updated = d.runs[i];
      }
    });
    return updated;
  }
  const { data, error } = await db().rpc("mavya_patch_run", { p_user: who, p_run: id, p_patch: patch });
  if (error) throw error;
  return data as Run | null;
}

export async function deleteRun(id: string, who: string): Promise<void> {
  if (!cloud()) {
    await writeDb((d) => {
      d.runs = d.runs.filter((r) => r.id !== id);
    });
    return;
  }
  const { error } = await db().from("runs").delete().eq("id", id).eq("user_id", who);
  if (error) throw error;
}

/* ---------- Media + assets ---------- */

/** Saves a file (an upload, a song clip, a generated hook). Saved as an asset, it also appears in My files. */
export async function saveMedia(file: File, asAsset: boolean, who: string): Promise<{ mediaId: string; mime: string }> {
  const mediaId = newMediaId(file.type);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!cloud()) {
    await mkdir(MEDIA_DIR, { recursive: true });
    await writeFile(path.join(MEDIA_DIR, mediaId), bytes);
    if (asAsset) {
      const asset: Asset = { mediaId, name: file.name.slice(0, 120), kind: kindOf(file.type), createdAt: new Date().toISOString() };
      await writeDb((d) => d.assets.push(asset));
    }
    return { mediaId, mime: file.type };
  }
  // The closing-account trigger must accept ownership before any R2 write. Deletion snapshots this identity even
  // if it starts while PUT is in flight. Keep the ledger on an ambiguous PUT failure so cleanup can still find it.
  await registerMedia(mediaId, file.type, bytes.length, who, asAsset ? file.name : null);
  try {
    await putObject(mediaKey(mediaId), bytes, file.type);
  } catch (error) {
    if (asAsset) {
      // Hide failed uploads from My files, but retain media ownership for an ambiguous completed PUT/deletion.
      const removed = await db().from("assets").delete().eq("media_id", mediaId).eq("user_id", who);
      if (removed.error) console.error("failed upload asset cleanup", removed.error);
    }
    throw error;
  }
  return { mediaId, mime: file.type };
}

/** Cloud: a direct upload to R2 starts here: a new media id and its object key. */
export function newUpload(mime: string): { mediaId: string; key: string } {
  const mediaId = newMediaId(mime);
  return { mediaId, key: mediaKey(mediaId) };
}

/** Cloud: record a file that is in R2 (after a direct upload); `assetName` also lists it in My files. */
export async function registerMedia(mediaId: string, mime: string, size: number, who: string, assetName: string | null): Promise<void> {
  const { error } = await db().from("media").insert({ id: mediaId, user_id: who, mime, size });
  if (error) throw error;
  if (assetName !== null) {
    const { error: e2 } = await db().from("assets").insert({ media_id: mediaId, user_id: who, name: assetName.slice(0, 120), kind: kindOf(mime) });
    if (e2) throw e2;
  }
}

/** Cloud: the size of an uploaded object, to check a direct upload really arrived. */
export const uploadedSize = (mediaId: string) => objectSize(mediaKey(mediaId));

export async function listAssets(who: string): Promise<Asset[]> {
  if (!cloud()) return [...(await readDb()).assets].sort(newest);
  const { data, error } = await db().from("assets").select("media_id, name, kind, created_at").eq("user_id", who).order("created_at", { ascending: false }).limit(2000);
  if (error) throw error;
  return (data as { media_id: string; name: string; kind: Asset["kind"]; created_at: string }[]).map((a) => ({ mediaId: a.media_id, name: a.name, kind: a.kind, createdAt: a.created_at }));
}

export async function deleteAsset(mediaId: string, who: string): Promise<void> {
  if (!cloud()) {
    await writeDb((d) => {
      d.assets = d.assets.filter((a) => a.mediaId !== mediaId);
    });
    await deleteMediaFile(mediaId);
    return;
  }
  const { error } = await db().from("assets").delete().eq("media_id", mediaId).eq("user_id", who);
  if (error) throw error;
  await deleteMediaFile(mediaId);
}

/** Whether `who` may read this file (their own, or shared library media), with its type and size. */
export async function mediaAccess(mediaId: string, who: string): Promise<{ mime: string; size: number } | null> {
  if (!isMediaId(mediaId)) return null;
  if (!cloud()) {
    try {
      const s = await stat(path.join(MEDIA_DIR, mediaId));
      return { mime: mimeOfId(mediaId), size: s.size };
    } catch {
      return null;
    }
  }
  const { data } = await db().from("media").select("user_id, mime, size").eq("id", mediaId).maybeSingle<{ user_id: string | null; mime: string; size: number }>();
  if (!data || (data.user_id !== null && data.user_id !== who)) return null;
  return { mime: data.mime, size: data.size };
}

/** Local: the file on disk (streamed by /api/media). Cloud: null; use mediaLink. */
export function localMediaPath(mediaId: string): string | null {
  return cloud() || !isMediaId(mediaId) ? null : path.join(MEDIA_DIR, mediaId);
}

/** Cloud: a short-lived link the browser reads the file from (after mediaAccess said yes). */
export const mediaLink = (mediaId: string, seconds?: number, download?: string) => signedGet(mediaKey(mediaId), seconds, download);

/** Cloud: a signed link to upload one new file, for the render server (the export). */
export const mediaUploadLink = (mediaId: string, mime: string, seconds: number) => signedPut(mediaKey(mediaId), mime, seconds);

/** A readable local copy of a media file in `dir` (for ffmpeg and the AI models), after an access check. */
export async function mediaToFile(mediaId: string, who: string, dir: string): Promise<{ file: string; mime: string } | null> {
  const access = await mediaAccess(mediaId, who);
  if (!access) return null;
  if (!cloud()) return { file: path.join(MEDIA_DIR, mediaId), mime: access.mime };
  const file = path.join(dir, mediaId);
  return (await downloadTo(mediaKey(mediaId), file)) ? { file, mime: access.mime } : null;
}

/** A library file by Instagram shortcode: the full video, the cut hook or demo clip, or the extracted sound. */
export type LibraryKind = "sources" | "hooks" | "demos" | "audio";
const LIBRARY_EXT: Record<LibraryKind, string> = { sources: "mp4", hooks: "mp4", demos: "mp4", audio: "m4a" };
export const libraryKey = (kind: LibraryKind, code: string) => `library/${kind}/${code}.${LIBRARY_EXT[kind]}`;

/** A local copy of a library file in `dir`, or null when it does not exist. */
export async function libraryFile(kind: LibraryKind, code: string, dir: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(code)) return null;
  if (!cloud()) {
    const file = path.join(DATA_DIR, kind, `${code}.${LIBRARY_EXT[kind]}`);
    try {
      await stat(file);
      return file;
    } catch {
      return null;
    }
  }
  const file = path.join(dir, `${kind}-${code}.${LIBRARY_EXT[kind]}`);
  return (await downloadTo(libraryKey(kind, code), file)) ? file : null;
}

/** Cloud: a short-lived link to a library file (the hook's sound for the player). */
export const libraryLink = (kind: LibraryKind, code: string, seconds?: number) => signedGet(libraryKey(kind, code), seconds);

async function deleteMediaFile(mediaId: string): Promise<void> {
  if (!isMediaId(mediaId)) return;
  // Removing an asset or history entry must not break a run or another reference that still uses the file.
  const usedBy = (value: unknown): boolean => {
    if (typeof value === "string") return value === mediaId || value === `/api/media/${mediaId}`;
    if (Array.isArray(value)) return value.some(usedBy);
    return !!value && typeof value === "object" && Object.values(value).some(usedBy);
  };
  if (!cloud()) {
    if (usedBy(await readDb())) return;
    await unlink(path.join(MEDIA_DIR, mediaId)).catch(() => undefined);
    return;
  }
  // A display-list scan cannot prove absence of references, especially during concurrent edits.
  // Cloud media stay owned/readable until account deletion; removing My files only unlists the asset.
  // Temporary export PNGs have their own bounded lifecycle and never appear in My files.
  return;
}



/* ---------- My files: names and removals ---------- */

/**
 * What the seller changed in My files: a name per item, and items removed from the list. Removing only hides the
 * item there; videos that use the file keep it. One small JSON per user (local: in .data; cloud: in R2).
 */
export type FilePrefs = { names: Record<string, string>; hidden: string[] };
const prefsKey = (who: string) => `prefs/${who}/files.json`;
const PREFS_FILE = path.join(DATA_DIR, "file-prefs.json");

export async function getFilePrefs(who: string): Promise<FilePrefs> {
  const empty: FilePrefs = { names: {}, hidden: [] };
  let text: string | null = null;
  if (!cloud()) {
    text = await readFile(PREFS_FILE, "utf8").catch(() => null);
  } else {
    const dir = await mkdtemp(path.join(tmpdir(), "mavya-prefs-"));
    try {
      const file = path.join(dir, "files.json");
      if (await downloadTo(prefsKey(who), file)) text = await readFile(file, "utf8");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  try {
    const v = text ? (JSON.parse(text) as Partial<FilePrefs>) : {};
    return { names: v.names && typeof v.names === "object" ? v.names : {}, hidden: Array.isArray(v.hidden) ? v.hidden : [] };
  } catch {
    return empty;
  }
}

export async function setFilePrefs(who: string, prefs: FilePrefs): Promise<void> {
  const body = JSON.stringify(prefs);
  if (!cloud()) {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(`${PREFS_FILE}.tmp`, body);
    await rename(`${PREFS_FILE}.tmp`, PREFS_FILE);
    return;
  }
  await putObject(prefsKey(who), Buffer.from(body), "application/json");
}

/** Append under the database lock, never from a browser/read-modify-write array snapshot. */
export async function appendExport(id: string, mediaId: string, result: {src: string; seconds: number; at: string}, who: string) {
  if (cloud()) {
    const {data,error} = await db().rpc("mavya_append_export", {p_user:who,p_run:id,p_media:mediaId,p_result:result});
    if (error) throw error;
    return data as typeof result | null;
  }
  let done: typeof result | null = null;
  await writeDb(d => {
    const run=d.runs.find(r=>r.id===id);
    if (!run) return;
    done=run.exports?.find(x=>x.src===result.src) ?? result;
    if (!run.exports?.some(x=>x.src===result.src)) run.exports=[...(run.exports??[]),result];
  });
  return done;
}

/** One bounded thumbnail read for a page, rather than one database query per card. */
export async function referenceThumbnails(ids: string[], segment: number, who: string): Promise<{id: string; thumb: string | null}[]> {
  if (!cloud()) return (await readDb()).references.filter(ref => ids.includes(ref.id)).map(ref => ({ id: ref.id, thumb: ref.analysis?.segments[segment]?.thumb ?? (segment === 0 ? ref.thumbUrl ?? null : null) }));
  const { data, error } = await db().from("library").select(`id,thumb:data->analysis->segments->${segment}->>thumb,fallback:data->>thumbUrl`).in("id", ids).or(`owner.eq.curated,user_id.eq.${who}`);
  if (error) throw error;
  return (data as unknown as {id: string; thumb: string | null; fallback: string | null}[]).map(row => ({ id: row.id, thumb: row.thumb ?? (segment === 0 ? row.fallback : null) }));
}
