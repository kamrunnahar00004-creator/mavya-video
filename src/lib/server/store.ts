import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Asset, Reference, Run } from "@/lib/types";

/**
 * Local-first storage (stage 1). Records live in .data/db.json and files in
 * .data/media. Every read and write goes through these functions, so moving to
 * Supabase later means replacing this one file.
 */
const DATA_DIR = path.join(process.cwd(), ".data");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const DB_FILE = path.join(DATA_DIR, "db.json");

type Db = { references: Reference[]; runs: Run[]; assets: Asset[] };

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

function kindOf(mime: string): Asset["kind"] {
  return mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "video";
}

let cached: { stamp: string; db: Db } | null = null;
async function readDb(): Promise<Db> {
  try {
    const info = await stat(DB_FILE);
    const stamp = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    if (cached?.stamp === stamp) return cached.db;
    const db = JSON.parse(await readFile(DB_FILE, "utf8")) as Partial<Db>;
    if (!Array.isArray(db.references) || !Array.isArray(db.runs) || !Array.isArray(db.assets)) throw new Error("Invalid local database");
    const result = { references: db.references, runs: db.runs, assets: db.assets };
    cached = { stamp, db: result };
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { references: [], runs: [], assets: [] };
    throw error;
  }
}

let writing: Promise<void> = Promise.resolve();
async function writeDb(update: (db: Db) => void): Promise<void> {
  // Serialize writes so two requests never interleave on db.json.
  const operation = writing.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    // Never mutate the cached snapshot before the atomic replacement succeeds.
    const db = structuredClone(await readDb());
    update(db);
    const tmp = `${DB_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, DB_FILE);
    cached = null;
  });
  writing = operation.catch(() => undefined);
  await operation;
}

const newest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

/* ---------- References (viral library) ---------- */

export async function listReferences(): Promise<Reference[]> {
  return [...(await readDb()).references].sort(newest);
}

export async function getReference(id: string): Promise<Reference | null> {
  return (await readDb()).references.find((r) => r.id === id) ?? null;
}

export async function createReference(input: Omit<Reference, "id" | "createdAt" | "analysis">): Promise<Reference> {
  const ref: Reference = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), analysis: null };
  await writeDb((db) => db.references.push(ref));
  return ref;
}

export async function updateReference(id: string, patch: Partial<Pick<Reference, "title" | "platform" | "sourceUrl" | "views" | "analysis" | "pending" | "review">>): Promise<Reference | null> {
  let updated: Reference | null = null;
  await writeDb((db) => {
    const i = db.references.findIndex((r) => r.id === id);
    if (i >= 0) {
      db.references[i] = { ...db.references[i], ...patch };
      updated = db.references[i];
    }
  });
  return updated;
}

export async function deleteReference(id: string): Promise<void> {
  let mediaId: string | null = null;
  await writeDb((db) => {
    mediaId = db.references.find((r) => r.id === id)?.mediaId ?? null;
    db.references = db.references.filter((r) => r.id !== id);
  });
  if (mediaId) await deleteMediaFile(mediaId);
}

/* ---------- Runs ---------- */

export async function listRuns(): Promise<Run[]> {
  return [...(await readDb()).runs].sort(newest);
}

export async function getRun(id: string): Promise<Run | null> {
  return (await readDb()).runs.find((r) => r.id === id) ?? null;
}

export async function createRun(): Promise<Run> {
  const now = new Date().toISOString();
  const run: Run = {
    id: randomUUID(),
    title: "Untitled run",
    createdAt: now,
    updatedAt: now,
    sourceRefId: null,
    hook: { mode: "upload", text: "How is this tool even legal?", clip: null, avatarIndex: null, variationIndex: null },
    demo: { clip: null, frame: "laptop" },
    project: null,
  };
  await writeDb((db) => db.runs.push(run));
  return run;
}

export async function updateRun(id: string, patch: Partial<Omit<Run, "id" | "createdAt">>): Promise<Run | null> {
  let updated: Run | null = null;
  await writeDb((db) => {
    const i = db.runs.findIndex((r) => r.id === id);
    if (i >= 0) {
      db.runs[i] = { ...db.runs[i], ...patch, updatedAt: new Date().toISOString() };
      updated = db.runs[i];
    }
  });
  return updated;
}

export async function deleteRun(id: string): Promise<void> {
  await writeDb((db) => {
    db.runs = db.runs.filter((r) => r.id !== id);
  });
}

/* ---------- Media + assets ---------- */

export function isMediaId(id: string): boolean {
  return /^[0-9a-f-]{36}\.(mp4|mov|webm|jpg|png|mp3|m4a|aac|wav)$/.test(id);
}

/** Saves an uploaded file. Files saved as library assets also appear in the Library panel. */
export async function saveMedia(file: File, asAsset: boolean): Promise<{ mediaId: string; mime: string }> {
  const ext = EXT_BY_MIME[file.type];
  if (!ext) throw new Error("Unsupported file type");
  await mkdir(MEDIA_DIR, { recursive: true });
  const mediaId = `${randomUUID()}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, mediaId), Buffer.from(await file.arrayBuffer()));
  if (asAsset) {
    const asset: Asset = { mediaId, name: file.name.slice(0, 120), kind: kindOf(file.type), createdAt: new Date().toISOString() };
    await writeDb((db) => db.assets.push(asset));
  }
  return { mediaId, mime: file.type };
}

export async function listAssets(): Promise<Asset[]> {
  return [...(await readDb()).assets].sort(newest);
}

export async function deleteAsset(mediaId: string): Promise<void> {
  await writeDb((db) => {
    db.assets = db.assets.filter((a) => a.mediaId !== mediaId);
  });
  await deleteMediaFile(mediaId);
}

export async function mediaInfo(mediaId: string): Promise<{ file: string; size: number; mime: string } | null> {
  if (!isMediaId(mediaId)) return null;
  const file = path.join(MEDIA_DIR, mediaId);
  try {
    const s = await stat(file);
    const ext = mediaId.split(".").pop() ?? "";
    const mime = Object.entries(EXT_BY_MIME).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
    return { file, size: s.size, mime };
  } catch {
    return null;
  }
}

async function deleteMediaFile(mediaId: string): Promise<void> {
  if (!isMediaId(mediaId)) return;
  await unlink(path.join(MEDIA_DIR, mediaId)).catch(() => undefined);
}
