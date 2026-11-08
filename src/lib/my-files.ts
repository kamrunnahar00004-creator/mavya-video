/**
 * My files (founder 2026-11-09: "many of my files are missing... I didn't delete them"). What each tab holds:
 *  1. Generated hooks: every hook generated (or uploaded under "Generate your hook" and used as the generated hook).
 *  2. Characters: every character or photo ever picked.
 *  3. Demos: the demo part of every export, each demo ONCE (exporting the same demo again, or reusing a demo under
 *     another hook, does not list it again).
 *  4. Uploaded: every clip or asset uploaded (Add your demo, sounds, photos), never a hook uploaded under "Generate
 *     your hook" (those are not assets).
 *  5. Music: every song picked from the library and every sound uploaded.
 *  6. Hooks: every hook ever picked.
 *  7. Exported: every export.
 * Found 2026-11-09: the tabs were built only from the videos that still exist, so deleting a video (its clips were
 * wrong) took its generated hooks, demos, exports, hooks, characters and music out of My files; and only the first 24
 * uploads were loaded (the rest behind a "Load more" above the header). Now the tabs are built from the records that
 * outlive a video (generations, export jobs, assets) as well as the videos, all loaded at once (GET /api/files).
 * Only Delete in My files removes an item, and only from the list. Pure: tested in scripts/my-files-checks.cjs.
 */
import type { Asset, Reference, Run, SoundPiece } from "@/lib/types";

export type Face = NonNullable<Run["hook"]["face"]>;
export type Generated = NonNullable<Run["hook"]["generated"]>;
export type ExportItem = NonNullable<Run["exports"]>[number];

/** A finished generation, kept after its video is deleted. `from`: the video as it was when the hook was generated. */
export type GenSource = { runId: string; at: string; result: Generated; from: Pick<Run, "title" | "sourceRefId" | "hook"> };
/** One demo segment, comparable across exports: its file, the pieces played, speed and look (null = untouched). */
export type DemoPart = { m: string; p: [number, number][]; sp: number; lk: string | null; g: number };
/** A finished export, kept after its video is deleted. `demoTexts`: the demo's texts (exports since 2026-11-09). */
export type ExportSource = { runId: string; at: string; src: string; seconds: number; demo?: { src: string; seconds: number }; demoParts: DemoPart[] | null; demoTexts: string | null; sounds: string[] };
export type FileSources = { runs: Run[]; generations: GenSource[]; exports: ExportSource[]; assets: Asset[]; refs: Reference[] };

export type Entry<T> = { key: string; at: string; runId?: string; runTitle?: string; hookText?: string; kind: string; value: T };
export type Files = {
  hooks: Entry<Reference>[];
  faces: Entry<Face>[];
  generated: Entry<{ g: Generated; run: Run }>[];
  demos: Entry<{ demo: { src: string; seconds: number }; run: Run }>[];
  uploads: Entry<Asset>[];
  music: Entry<SoundPiece>[];
  exports: Entry<ExportItem>[];
};

const titleOf = (t: string | undefined) => (!t || t === "Untitled run" ? "Untitled video" : t);
const r2 = (n: number) => Math.round(n * 100) / 100;
export const faceKey = (f: Face) => (f.kind === "photo" ? `photo:${f.mediaId}` : f.kind === "ai" ? `ai:${f.index}` : f.kind === "character" ? `character:${f.id}` : `described:${f.text}`);

/** A stored file's id from any link to it ("https://...r2.../media/<id>.v1080.mp4?sig", "/api/media/<id>.mp4"). */
export function mediaOf(url: string): string | null {
  const m = /(?:^|\/)(?:api\/)?media\/([\w-]+)(?:\.v\d+)?\.(\w+)(?:[?#]|$)/.exec(url);
  return m ? `${m[1]}.${m[2]}` : null;
}
/** Where a sound in an export plays from in the app: a stored file, or a library hook's own sound. */
export function soundSrcOf(url: string): string | null {
  const media = mediaOf(url);
  if (media) return `/api/media/${media}`;
  const lib = /(?:^|\/)library\/audio\/([A-Za-z0-9_-]{5,40})\.\w+(?:[?#]|$)/.exec(url);
  return lib ? `/api/sounds/${lib[1]}` : null;
}

type SpecSegment = { url?: string; gap?: number; speed?: number; look?: Record<string, unknown> | null; pieces?: { start: number; end: number; look?: unknown }[] };
/** The demo segments of an export spec (every segment after the hook's), comparable: links reduced to their file. */
export function demoPartsOf(segments: SpecSegment[] | undefined): DemoPart[] | null {
  if (!Array.isArray(segments) || segments.length < 2) return null;
  return segments.slice(1).map((s) => {
    const look = s.look ?? null;
    const plain = !look || (["brightness", "contrast", "saturation", "warmth", "zoom", "panX", "panY"].every((k) => !look[k]) && !look.flip && !(Array.isArray(look.keys) && look.keys.length));
    const pieceLooks = (s.pieces ?? []).some((p) => p.look);
    return {
      m: mediaOf(s.url ?? "") ?? String(s.url ?? "").replace(/[?#].*$/, "").replace(/^https?:\/\/[^/]+\//, ""),
      p: (s.pieces ?? []).map((p) => [r2(p.start), r2(p.end)] as [number, number]),
      sp: s.speed ?? 1,
      // Black frames before the clip (a gap) change the picture and its length.
      g: r2(s.gap ?? 0),
      lk: plain && !pieceLooks ? null : JSON.stringify([look, (s.pieces ?? []).map((p) => p.look ?? null)]),
    };
  });
}

/** A runaway guard only: no video is picked from this many times by hand. */
const PICKED_MAX = 5000;
/**
 * The video's pick history with what this save picks added (each once, oldest first, at most PICKED_MAX of each), or
 * null when nothing new is picked. Kept by the server on every save, so a hook, character or sound picked and then
 * replaced stays in My files.
 */
export function pickedWith(had: Run["picked"], patch: Partial<Run>, at: string): Run["picked"] | null {
  const refs = [...(had?.refs ?? [])], faces = [...(had?.faces ?? [])], sounds = [...(had?.sounds ?? [])];
  let changed = false;
  if (typeof patch.sourceRefId === "string" && patch.sourceRefId && !refs.some((r) => r.id === patch.sourceRefId)) { refs.push({ id: patch.sourceRefId, at }); changed = true; }
  const face = patch.hook?.face;
  if (face && !faces.some((f) => faceKey(f.face) === faceKey(face))) { faces.push({ face, at }); changed = true; }
  for (const p of [...(patch.sounds ?? []), ...(patch.sound ? [patch.sound] : [])]) {
    if (!p?.src || sounds.some((x) => x.src === p.src)) continue;
    sounds.push({ kind: p.kind, src: p.src, name: p.name, ...(p.refId ? { refId: p.refId } : {}), at });
    changed = true;
  }
  return changed ? { refs: refs.slice(-PICKED_MAX), faces: faces.slice(-PICKED_MAX), sounds: sounds.slice(-PICKED_MAX) } : null;
}

/** Everything My files lists, from the saved records and the videos (the open one as it is now: `current`). */
export function buildFiles(src: FileSources, current: Run | null): Files {
  const runs = current ? [current, ...src.runs.filter((r) => r.id !== current.id)] : src.runs;
  const runById = new Map(runs.map((r) => [r.id, r]));
  // A deleted video's title and hook words, from what its generations recorded.
  const lastGen = new Map<string, GenSource>();
  for (const g of [...src.generations].sort((a, b) => a.at.localeCompare(b.at))) lastGen.set(g.runId, g);
  const fromOf = (runId: string): { runId: string; runTitle: string } => ({ runId, runTitle: titleOf(runById.get(runId)?.title ?? lastGen.get(runId)?.from.title) });
  // The video a generated hook or demo came from, for Use (its hook and character come along).
  const asRun = (runId: string, at: string): Run => runById.get(runId) ?? ({ id: runId, createdAt: at, updatedAt: at, title: lastGen.get(runId)?.from.title ?? "Untitled video", sourceRefId: lastGen.get(runId)?.from.sourceRefId ?? null, hook: lastGen.get(runId)?.from.hook ?? { mode: "upload", text: "" } } as unknown as Run);
  const oldestRuns = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const gensOldest = [...src.generations].sort((a, b) => a.at.localeCompare(b.at));
  const refById = new Map(src.refs.map((r) => [r.id, r]));

  // 6. Hooks: each hook once, under the first video that used it.
  const hooks: Entry<Reference>[] = [];
  const seenHook = new Set<string>();
  const addHook = (refId: string | null | undefined, at: string, runId?: string) => {
    const ref = refId ? refById.get(refId) : undefined;
    if (!ref || seenHook.has(ref.id)) return;
    seenHook.add(ref.id);
    hooks.push({ key: `hook:${ref.id}`, at, ...(runId ? fromOf(runId) : {}), kind: ref.owner === "user" ? "upload" : "library", value: ref });
  };
  // Videos and generations together, oldest first: each hook and character is listed under its first use.
  const uses = [
    ...runs.map((r) => ({ when: r.createdAt, at: r.updatedAt, runId: r.id, refId: r.sourceRefId, face: r.hook?.face })),
    ...runs.flatMap((r) => [
      ...(r.picked?.refs ?? []).map((p) => ({ when: p.at, at: p.at, runId: r.id, refId: p.id, face: undefined })),
      ...(r.picked?.faces ?? []).map((p) => ({ when: p.at, at: p.at, runId: r.id, refId: undefined, face: p.face })),
    ]),
    ...src.generations.map((g) => ({ when: g.at, at: g.at, runId: g.runId, refId: g.from.sourceRefId, face: g.from.hook?.face })),
  ].sort((a, b) => a.when.localeCompare(b.when));
  for (const u of uses) addHook(u.refId, u.at, u.runId);
  for (const ref of src.refs) if (ref.owner === "user" && ref.mediaId) addHook(ref.id, ref.createdAt);

  // 2. Characters: each character or photo once.
  const faces: Entry<Face>[] = [];
  const seenFace = new Set<string>();
  const addFace = (f: Face | null | undefined, at: string, runId?: string) => {
    if (!f || seenFace.has(faceKey(f))) return;
    seenFace.add(faceKey(f));
    faces.push({ key: `face:${faceKey(f)}`, at, ...(runId ? fromOf(runId) : {}), kind: f.kind === "photo" ? "photo" : "character", value: f });
  };
  for (const u of uses) addFace(u.face, u.at, u.runId);

  // 1. Generated hooks: each file once (reusing one in another video makes no copy).
  const generated: Entry<{ g: Generated; run: Run }>[] = [];
  const seenGen = new Set<string>();
  const addGen = (g: Generated, runId: string, from: Run) => {
    if (!g?.src || seenGen.has(g.src)) return;
    seenGen.add(g.src);
    generated.push({ key: `generated:${g.src}`, at: g.at, ...fromOf(runId), kind: "all", value: { g, run: from } });
  };
  // Use brings the hook and character this hook was generated with (its own record), not the video's latest ones.
  for (const g of gensOldest) addGen(g.result, g.runId, { ...asRun(g.runId, g.at), title: g.from.title, sourceRefId: g.from.sourceRefId, hook: g.from.hook } as Run);
  for (const r of oldestRuns) for (const g of [...(r.hook?.versions ?? []), ...(r.hook?.generated ? [r.hook.generated] : [])]) addGen(g, r.id, r);

  // 7. Exported, and 3. Demos: the export jobs (kept after a video is deleted) and any export only its video records.
  const jobs = [...src.exports].sort((a, b) => a.at.localeCompare(b.at));
  const jobSrcs = new Set(jobs.map((x) => x.src));
  type Ex = { runId: string; at: string; src: string; seconds: number; demo?: { src: string; seconds: number }; demoKey: string | null; sounds: string[] };
  const all: Ex[] = [];
  // A demo's identity: its segments and texts. A demo file reused untouched as the whole demo (Use in Demos) is that
  // same demo, so its export lists nothing new.
  const demoFiles = new Map<string, { parts: DemoPart[]; texts: string[]; seconds: number }>();
  for (const x of jobs) {
    let key: string | null = null;
    if (x.demo && x.demoParts) {
      const parts: DemoPart[] = [];
      const texts: string[] = [];
      for (const part of x.demoParts) {
        const same = demoFiles.get(part.m);
        const whole = same && part.sp === 1 && part.lk === null && part.g === 0 && part.p.length === 1 && Math.abs(part.p[0][0]) < 0.05 && Math.abs(part.p[0][1] - same.seconds) < 0.15;
        if (same && whole) { parts.push(...same.parts); texts.push(...same.texts); } else parts.push(part);
      }
      if (x.demoTexts && x.demoTexts !== "[]") texts.push(x.demoTexts);
      key = JSON.stringify([parts, texts]);
      const file = mediaOf(x.demo.src);
      if (file) demoFiles.set(file, { parts, texts, seconds: x.demo.seconds });
    }
    all.push({ runId: x.runId, at: x.at, src: x.src, seconds: x.seconds, demo: x.demo, demoKey: key, sounds: x.sounds });
  }
  for (const r of runs) for (const x of r.exports ?? []) if (!jobSrcs.has(x.src)) all.push({ runId: r.id, at: x.at, src: x.src, seconds: x.seconds, demo: x.demo, demoKey: null, sounds: [] });

  const exported: Entry<ExportItem>[] = [];
  const seenExport = new Set<string>();
  for (const x of all) {
    if (seenExport.has(x.src)) continue;
    seenExport.add(x.src);
    const hookText = runById.get(x.runId)?.hook?.text ?? lastGen.get(x.runId)?.from.hook?.text;
    exported.push({ key: `export:${x.src}`, at: x.at, ...fromOf(x.runId), hookText, kind: "all", value: { src: x.src, seconds: x.seconds, at: x.at, ...(x.demo ? { demo: x.demo } : {}) } });
  }

  // Each demo once: the newest export of it, listed under its first export's file, which never changes, so a name
  // given or a Delete stays when the same demo is exported again (Codex 2026-11-09).
  const demoGroups = new Map<string, { first: Ex; newest: Ex }>();
  for (const x of all) {
    if (!x.demo) continue;
    const key = x.demoKey ?? `src:${x.demo.src}`;
    const had = demoGroups.get(key);
    if (!had) demoGroups.set(key, { first: x, newest: x });
    else {
      if (x.at < had.first.at) had.first = x;
      if (x.at > had.newest.at) had.newest = x;
    }
  }
  const demos: Entry<{ demo: { src: string; seconds: number }; run: Run }>[] = [...demoGroups.values()].map(({ first, newest: x }) => ({ key: `demo:${first.demo!.src}`, at: x.at, ...fromOf(x.runId), kind: "all", value: { demo: x.demo!, run: asRun(x.runId, x.at) } }));

  // 4. Uploaded: every uploaded clip and picture, except a picture uploaded as a face (Characters) and a clip uploaded
  // under "Generate your hook" (Generated hooks). Sounds are under Music.
  const facePhotos = new Set(faces.filter((f) => f.value.kind === "photo").map((f) => (f.value as { mediaId: string }).mediaId));
  const asHook = new Set(generated.map((x) => mediaOf(x.value.g.src)).filter((m): m is string => Boolean(m)));
  const uploads: Entry<Asset>[] = src.assets
    .filter((a) => (a.kind === "video" || a.kind === "image") && !facePhotos.has(a.mediaId) && !asHook.has(a.mediaId))
    .map((a) => ({ key: `upload:${a.mediaId}`, at: a.createdAt, kind: "all", value: a }));

  // 5. Music: every sound used in a video or an export, and every sound uploaded or song saved; each once.
  const music: Entry<SoundPiece>[] = [];
  const seenSound = new Set<string>();
  const assetByMedia = new Map(src.assets.map((a) => [a.mediaId, a]));
  const refByCode = new Map<string, Reference>();
  for (const ref of src.refs) { const code = /\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/.exec(ref.sourceUrl ?? "")?.[1]; if (code) refByCode.set(code, ref); }
  const addSound = (p: Omit<SoundPiece, "id" | "at" | "start" | "volume"> & Partial<SoundPiece>, at: string, runId?: string) => {
    if (!p.src || seenSound.has(p.src)) return;
    seenSound.add(p.src);
    music.push({ key: `music:${p.src}`, at, ...(runId ? fromOf(runId) : {}), kind: p.kind, value: { id: "main", at: 0, row: 0, start: 0, volume: 100, ...p } as SoundPiece });
  };
  for (const r of oldestRuns) for (const p of r.sounds ?? (r.sound ? [{ id: "main", at: 0, row: 0, ...r.sound }] : [])) addSound(p, r.updatedAt, r.id);
  for (const r of oldestRuns) for (const p of r.picked?.sounds ?? []) addSound({ kind: p.kind, src: p.src, name: p.name, refId: p.refId }, p.at, r.id);
  // A saved song has no file extension in its name; an uploaded sound keeps its file's name.
  const songName = (a: Asset) => !/\.\w{2,4}$/.test(a.name);
  for (const x of all) for (const s of x.sounds) {
    const media = /^\/api\/media\/(.+)$/.exec(s)?.[1];
    const asset = media ? assetByMedia.get(media) : undefined;
    const code = /^\/api\/sounds\/(.+)$/.exec(s)?.[1];
    const ref = code ? refByCode.get(code) : undefined;
    if (code) addSound({ kind: "hook", src: s, name: ref?.author ? `@${ref.author}` : ref?.title || "Viral sound", refId: ref?.id }, x.at, x.runId);
    else addSound({ kind: asset && !songName(asset) ? "upload" : "song", src: s, name: asset ? asset.name.replace(/\.\w{2,4}$/, "") : "Song" }, x.at, x.runId);
  }
  for (const a of src.assets) if (a.kind === "audio") addSound({ kind: songName(a) ? "song" : "upload", src: `/api/media/${a.mediaId}`, name: a.name.replace(/\.\w{2,4}$/, "") }, a.createdAt);

  return { hooks, faces, generated, demos, uploads, music, exports: exported };
}
