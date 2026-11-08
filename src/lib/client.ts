import type { Clip, Project, Reference, Run, Slot, TextLayer } from "@/lib/types";
import { DEFAULT_FONT } from "@/lib/studio-data";
import { touchesEdit } from "@/lib/edit-version";

/** Hook remixes until the text model is connected: same energy, aimed at the product. */
export function remixHook(original: string, product: string, audience: string): string[] {
  const p = product.trim() || "this app";
  const a = audience.trim() || "people like me";
  const base = original.trim();
  return [
    base ? `${base.replace(/[?!.]+$/, "")}... and nobody told ${a} about ${p}??` : `How is ${p} even legal?`,
    `${a.charAt(0).toUpperCase()}${a.slice(1)}, stop doing it the hard way. ${p} exists.`,
    `POV: you're one of the ${a} who just found ${p}`,
  ];
}

export const uid = () => Math.random().toString(36).slice(2, 10);
export const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Upload a file. With cloud storage the browser sends it straight to storage (no size limit from the server);
 * without it (local), through POST /api/media.
 */
export async function uploadFile(file: File, asAsset: boolean, purpose?: "export-text", signal?: AbortSignal): Promise<{ mediaId: string; mime: string }> {
  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const start = await fetch("/api/uploads", json({ step: "start", mime: file.type, size: file.size, purpose }));
  if (start.status !== 501) {
    const s = (await start.json().catch(() => ({}))) as { mediaId?: string; url?: string; error?: string };
    if (!start.ok || !s.mediaId || !s.url) throw new Error(s.error ?? "Upload failed");
    const put = await fetch(s.url, { method: "PUT", headers: { "content-type": file.type }, body: file, signal }).catch(() => null);
    signal?.throwIfAborted();
    if (!put?.ok) throw new Error("Upload failed. Check your connection and try again.");
    const done = await fetch("/api/uploads", json({ step: "finish", mediaId: s.mediaId, mime: file.type, name: file.name, asset: asAsset }));
    const d = (await done.json().catch(() => ({}))) as { mediaId?: string; error?: string };
    if (!done.ok || !d.mediaId) throw new Error(d.error ?? "Upload failed");
    return { mediaId: d.mediaId, mime: file.type };
  }
  const form = new FormData();
  form.append("file", file);
  if (asAsset) form.append("asset", "1");
  const res = await fetch("/api/media", { method: "POST", body: form, signal });
  const data = (await res.json()) as { mediaId?: string; mime?: string; error?: string };
  if (!res.ok || !data.mediaId) throw new Error(data.error ?? "Upload failed");
  return { mediaId: data.mediaId, mime: data.mime ?? file.type };
}

export function videoLength(mediaId: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const finish = (value: number | null) => {
      clearTimeout(timer);
      v.onloadedmetadata = v.onerror = null;
      v.removeAttribute("src");
      v.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 15000);
    v.onloadedmetadata = () => finish(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => finish(null);
    v.src = `/api/media/${mediaId}`;
  });
}

/** A video's length from the file on this computer: instant, nothing fetched. Null when the browser can't read it. */
function fileLength(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const finish = (value: number | null) => {
      clearTimeout(timer);
      v.onloadedmetadata = v.onerror = null;
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 5000);
    v.onloadedmetadata = () => finish(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => finish(null);
    v.src = url;
  });
}

/** Turns an uploaded file into a clip ready for a slot. */
export async function clipFromFile(file: File, signal?: AbortSignal): Promise<Clip> {
  const kind = file.type.startsWith("image/") ? "image" : "video";
  const [{ mediaId }, local] = await Promise.all([uploadFile(file, true, undefined, signal), kind === "video" ? fileLength(file) : null]);
  return { mediaId, name: file.name, kind, offset: 0, length: kind === "video" ? (local ?? (await videoLength(mediaId))) : null };
}

export async function clipFromAsset(asset: { mediaId: string; name: string; kind: "video" | "image" }): Promise<Clip> {
  return { mediaId: asset.mediaId, name: asset.name, kind: asset.kind, offset: 0, length: asset.kind === "video" ? await videoLength(asset.mediaId) : null };
}

type PendingSave = { patch: Partial<Run>; timer: ReturnType<typeof setTimeout>; done: ((run: Run | null) => void)[] };
const pendingSaves = new Map<string, PendingSave>();
const saveChains = new Map<string, Promise<Run | null>>();
/**
 * The version of each video this page's edits are based on (edit-version.ts): set when the video loads, moved on by
 * each save the server takes. Sent with every editor save; the server refuses a save from an older copy.
 */
const editVersions = new Map<string, string | null>();
/** The video loaded (or loaded again): later saves are based on this version. */
export function setEditVersion(id: string, version: string | undefined | null) {
  // A fresh copy: anything still queued, waiting or due for a retry is from the old one (the page waited for its own
  // saves before loading, run-view) and is never sent under this version (Codex 2026-11-08).
  saveGenerations.set(id, (saveGenerations.get(id) ?? 0) + 1);
  const queued = pendingSaves.get(id);
  if (queued) { clearTimeout(queued.timer); pendingSaves.delete(id); queued.done.forEach((resolve) => resolve(null)); }
  editVersions.set(id, version ?? null);
  // Save ids from the old copy prove nothing about this one (it may even be older than them; Codex 2026-11-08).
  unanswered.delete(id);
  ownSaveIds.delete(id);
  suspended.delete(id);
  refusedSections.delete(id);
  generationOnly.delete(id);
}
/** The run sections this page has edited but the server has not confirmed yet (queued, waiting or in flight). */
export function unsavedSections(id: string): Set<string> {
  const keys = new Set<string>(Object.keys(pendingSaves.get(id)?.patch ?? {}));
  for (const patch of sentPatches.get(id)?.values() ?? []) Object.keys(patch).forEach((k) => keys.add(k));
  keys.delete("project");
  return keys;
}
/**
 * A generated hook landed: the server wrote the hook and captions and moved the version on in the same write (migration
 * 0019). Every save this page had not sent yet was made from before it; sent now under the new version it would
 * overwrite the generated hook, so all of them are cancelled (queued or waiting behind another request), and one
 * that was already on its way and gets refused is dropped quietly. The page then saves its merged state again
 * (run-view onGenerated, from unsavedSections), so no edit is lost (Codex 2026-11-08).
 */
export function adoptGeneratedVersion(id: string, version: string) {
  editVersions.set(id, version);
  suspended.delete(id);
  generationOnly.delete(id);
  saveGenerations.set(id, (saveGenerations.get(id) ?? 0) + 1);
  const queued = pendingSaves.get(id);
  if (!queued) return;
  clearTimeout(queued.timer);
  pendingSaves.delete(id);
  queued.done.forEach((resolve) => resolve(null));
}
/**
 * Videos whose copy on this page was refused, until the latest version is loaded (setEditVersion): edits made from the
 * old copy meanwhile are dropped, never sent later under the new version (Codex 2026-11-08).
 */
const suspended = new Set<string>();
/** Event sent when the server refused this page's save because the video changed elsewhere; detail: the video id. */
export const STALE_RUN_EVENT = "mavya:run-stale";
/**
 * Ids of this page's editor saves whose answers never came (a network failure after sending): the server may have
 * written one, so the retry names them and is taken if the video's version came from one of them (Codex 2026-11-08).
 */
const unanswered = new Map<string, string[]>();
const newSaveId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
/** The sections of this page's refused save and the edits dropped with it, kept for the page (takeRefusedSections). */
const refusedSections = new Map<string, Set<string>>();
/** The ids of this page's recent editor saves (the last 50), answered or not. */
const ownSaveIds = new Map<string, string[]>();
/**
 * A generated hook's result may be taken (adoptGeneratedVersion) only if the generation followed this page's own
 * version or one of its own saves: if another tab saved in between, its edits must not be saved over, so the page
 * loads the latest instead (Codex 2026-11-08).
 */
export function generationFollows(id: string, updated: Pick<Run, "editSave" | "editPrev" | "editPrevSave">): boolean {
  if (updated.editSave) return false;
  // (A video from before versions: no version on either side, nothing saved in between.)
  if ((updated.editPrev ?? null) === (editVersions.get(id) ?? null)) return true;
  return Boolean(updated.editPrevSave && (ownSaveIds.get(id) ?? []).includes(updated.editPrevSave));
}
/**
 * This page's copy is out of date and the page is loading the latest (run-view): every save it queued or has waiting is
 * cancelled and editor saves pause until the latest version is in (setEditVersion), so none goes out under the new
 * version (Codex 2026-11-08).
 */
export function abandonCopy(id: string) {
  saveGenerations.set(id, (saveGenerations.get(id) ?? 0) + 1);
  suspended.add(id);
  const queued = pendingSaves.get(id);
  if (!queued) return;
  clearTimeout(queued.timer);
  pendingSaves.delete(id);
  queued.done.forEach((resolve) => resolve(null));
}
/** Every refusal since the last load said the newer version was only a finished generation's (byGeneration). */
const generationOnly = new Map<string, boolean>();
export const refusedByGeneration = (id: string): boolean => generationOnly.get(id) === true;
/** The sections lost to a refusal, once: the page saves them again if a generated hook explains the refusal. */
export function takeRefusedSections(id: string): Set<string> {
  const keys = refusedSections.get(id) ?? new Set<string>();
  refusedSections.delete(id);
  return keys;
}
/** Bumped when a save is refused: saves queued before it are from the old copy and are never sent. */
const saveGenerations = new Map<string, number>();

/** Save status per run, for the "Saved" label: saving, saved, or error (a server or network failure is retried). */
export type SaveState = "idle" | "saving" | "saved" | "error";
const saveStates = new Map<string, SaveState>();
const saveErrors = new Map<string, string>();
const saveListeners = new Set<() => void>();
function setSaveState(id: string, state: SaveState, error?: string) {
  if (saveStates.get(id) === state && saveErrors.get(id) === error) return;
  if (error) saveErrors.set(id, error); else saveErrors.delete(id);
  saveStates.set(id, state);
  saveListeners.forEach((l) => l());
}
export function subscribeSaves(listener: () => void) {
  saveListeners.add(listener);
  return () => {
    saveListeners.delete(listener);
  };
}
export const saveStateOf = (id: string): SaveState => saveStates.get(id) ?? "idle";
export const saveErrorOf = (id: string): string | null => saveErrors.get(id) ?? null;

/** Patches sent or queued per run, by send order: a failed patch is retried only for sections nothing newer has written. */
let saveSeq = 0;
const sentPatches = new Map<string, Map<number, Partial<Run>>>();

function flushRun(id: string) {
  const pending = pendingSaves.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingSaves.delete(id);
  const seq = ++saveSeq;
  const sent = sentPatches.get(id) ?? new Map<number, Partial<Run>>();
  sent.set(seq, pending.patch);
  sentPatches.set(id, sent);
  // retry: a server or network failure (a rejected edit, 4xx, would fail again the same way).
  let retry = false;
  let refused = false;
  let dropped = false;
  const generation = saveGenerations.get(id) ?? 0;
  const editing = touchesEdit(pending.patch);
  const saveId = newSaveId();
  /** The server answered: it did or did not write this save, so its id is no longer unanswered. */
  const answered = () => unanswered.set(id, (unanswered.get(id) ?? []).filter((x) => x !== saveId));
  const operation = (saveChains.get(id) ?? Promise.resolve(null)).then(async () => {
    // Queued from a copy the server already refused: not sent (the page is loading the latest version).
    if ((saveGenerations.get(id) ?? 0) !== generation) {
      dropped = true;
      // Dropped with a refusal: the page may still save it again (takeRefusedSections).
      if (suspended.has(id)) { const lost = refusedSections.get(id) ?? new Set<string>(); Object.keys(pending.patch).filter((k) => k !== "project").forEach((k) => lost.add(k)); refusedSections.set(id, lost); }
      return null;
    }
    try {
      // Editor saves say which version they were made from, read now (after the saves before it landed), their own id
      // and the ids of this page's saves whose answers never came.
      if (editing) { const mine = unanswered.get(id) ?? []; unanswered.set(id, [...mine, saveId].slice(-20)); ownSaveIds.set(id, [...(ownSaveIds.get(id) ?? []), saveId].slice(-50)); }
      const body = JSON.stringify(editing ? { ...pending.patch, base: editVersions.get(id) ?? null, save: saveId, mine: (unanswered.get(id) ?? []).filter((x) => x !== saveId) } : pending.patch);
      // Browsers reject keepalive bodies above their 64 KiB quota, even on an open page.
      const keepalive = new TextEncoder().encode(body).byteLength < 60000;
      const res = await fetch(`/api/runs/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body, keepalive });
      if (res.ok) {
        const saved = (await res.json()) as Run;
        // Written and its answer read: the video holds this save, so no earlier unanswered one can be its version any
        // more (only now: an answer lost while reading leaves the ids for the retry, Codex 2026-11-08).
        if (editing) unanswered.delete(id);
        // A version adopted meanwhile (a generated hook) is newer than this answer: keep it.
        // Only an editor save moves this page's version: a rename's answer carries whatever version the video has
        // (maybe another tab's), and this page's captions are not that version (Codex 2026-11-08).
        if (editing && saved?.editVersion && (saveGenerations.get(id) ?? 0) === generation) editVersions.set(id, saved.editVersion);
        return saved;
      }
      if (res.status === 409) {
        answered();
        const why = await res.json().catch(() => null) as { byGeneration?: boolean } | null;
        // Sent before a generated hook was adopted: the page is saving its merged state again, nothing to do.
        if ((saveGenerations.get(id) ?? 0) !== generation) { dropped = true; return null; }
        // An older copy (the video changed in another tab or window): nothing queued from this copy is sent, and
        // the page loads the latest version (run-view listens). Never retried.
        refused = true;
        generationOnly.set(id, (generationOnly.get(id) ?? true) && why?.byGeneration === true);
        saveGenerations.set(id, generation + 1);
        suspended.add(id);
        const lost = new Set([...(refusedSections.get(id) ?? []), ...Object.keys(pending.patch)]);
        const queued = pendingSaves.get(id);
        if (queued) { Object.keys(queued.patch).forEach((k) => lost.add(k)); clearTimeout(queued.timer); pendingSaves.delete(id); queued.done.forEach((resolve) => resolve(null)); }
        lost.delete("project");
        refusedSections.set(id, lost);
        return null;
      }
      retry = res.status >= 500;
      if (!retry) answered();
      const failure = await res.json().catch(() => null) as { error?: unknown } | null;
      if (typeof failure?.error === "string") setSaveState(id, "error", failure.error.slice(0, 200));
      return null;
    } catch {
      retry = true;
      return null;
    }
  });
  saveChains.set(id, operation);
  void operation.then((run) => {
    pending.done.forEach((resolve) => resolve(run));
    if (saveChains.get(id) === operation) saveChains.delete(id);
    // Sections written by a newer patch already queued or in flight: the retry must not replay older values over them.
    const superseded = new Set<string>();
    for (const [s, patch] of sent) if (s > seq) Object.keys(patch).forEach((k) => superseded.add(k));
    sent.delete(seq);
    if (!sent.size && sentPatches.get(id) === sent) sentPatches.delete(id);
    if (run) {
      if (!pendingSaves.has(id) && !saveChains.has(id)) setSaveState(id, "saved");
      return;
    }
    if (dropped) { setSaveState(id, "idle"); return; }
    if (refused) {
      setSaveState(id, "idle");
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STALE_RUN_EVENT, { detail: id }));
      return;
    }
    // Its copy was replaced meanwhile (reload or a generated hook): never retried under the new version (Codex 2026-11-08).
    if ((saveGenerations.get(id) ?? 0) !== generation) { setSaveState(id, "idle"); return; }
    setSaveState(id, "error", saveErrors.get(id));
    if (!retry) return;
    const stale = Object.fromEntries(Object.entries(pending.patch).filter(([k]) => !superseded.has(k))) as Partial<Run>;
    if (!Object.keys(stale).length) return;
    // Try again in 3 s, under any newer edit (the newer values win).
    const newer = pendingSaves.get(id);
    if (newer) newer.patch = { ...stale, ...newer.patch };
    else pendingSaves.set(id, { patch: stale, done: [], timer: setTimeout(() => flushRun(id), 3000) });
  });
}

/** Keep live edits immediate, merge input bursts, and send writes in order per run. */
export function patchRun(id: string, patch: Partial<Run>): Promise<Run | null> {
  if (suspended.has(id) && touchesEdit(patch)) return Promise.resolve(null);
  if (saveStateOf(id) !== "error") setSaveState(id, "saving");
  return new Promise((resolve) => {
    const previous = pendingSaves.get(id);
    if (previous) clearTimeout(previous.timer);
    pendingSaves.set(id, { patch: { ...previous?.patch, ...patch }, done: [...(previous?.done ?? []), resolve], timer: setTimeout(() => flushRun(id), 250) });
  });
}

export function flushRunSaves() {
  for (const id of pendingSaves.keys()) flushRun(id);
}
/** Wait for queued edits before reserving work against the server's input snapshot. */
export async function waitRunSaves(id: string): Promise<boolean> {
  flushRun(id);
  const operation = saveChains.get(id);
  if (!operation) return saveStateOf(id) !== "error";
  if (!(await operation)) return false;
  if (pendingSaves.has(id) || saveChains.has(id)) return waitRunSaves(id);
  return true;
}
if (typeof window !== "undefined") window.addEventListener("pagehide", flushRunSaves);

const DEFAULT_SUGGESTION: Record<Slot["role"], string> = {
  hook: "Reaction to camera, big text on screen",
  body: "Phone filming the laptop, show the main feature",
  cta: "End card with the product name",
};
export { DEFAULT_SUGGESTION };

/** Builds the editor project for a run: reference structure, with the run's hook and demo clips placed in. */
export function buildProject(run: Run, ref: Reference | null): Project {
  const segs = ref?.analysis?.segments ?? [];
  const slots: Slot[] = segs.length
    ? segs.map((s) => ({ id: uid(), role: s.role, duration: round1(s.end - s.start), suggestion: s.note || DEFAULT_SUGGESTION[s.role], refStart: s.start, refThumb: s.thumb, clip: null }))
    : [
        { id: uid(), role: "hook", duration: 3, suggestion: DEFAULT_SUGGESTION.hook, refStart: null, clip: null },
        { id: uid(), role: "body", duration: 8, suggestion: DEFAULT_SUGGESTION.body, refStart: null, clip: null },
        { id: uid(), role: "cta", duration: 2.5, suggestion: DEFAULT_SUGGESTION.cta, refStart: null, clip: null },
      ];
  const hookSlot = slots.find((s) => s.role === "hook");
  if (hookSlot) {
    const start = run.hook.start ?? hookSlot.refStart ?? 0;
    const end = run.hook.end ?? start + hookSlot.duration;
    if (run.hook.end !== undefined) hookSlot.duration = round1(Math.max(0.5, end - start));
    if (run.hook.clip) hookSlot.clip = run.hook.clip;
    else if (run.hook.face && ref) {
      // Face swap is not connected yet: the source hook stands in for the swapped clip.
      hookSlot.clip = { mediaId: ref.mediaId, name: "Hook (face swap preview)", kind: "video", offset: start, length: ref.analysis?.duration ?? null };
    }
  }
  const demoSlot = slots.find((s) => s.role === "body");
  if (demoSlot && run.demo.clip) {
    demoSlot.clip = run.demo.clip;
    demoSlot.frame = run.demo.frame;
  }
  const hookEnd = hookSlot ? hookSlot.duration : 3;
  const total = slots.reduce((a, s) => a + s.duration, 0);
  const ctaSlot = slots.find((s) => s.role === "cta");
  const ctaStart = ctaSlot ? total - ctaSlot.duration : null;
  return {
    productName: "Mavya",
    refId: ref?.id ?? null,
    refMediaId: ref?.mediaId ?? null,
    refTitle: ref?.title ?? "",
    slots,
    texts: [
      { id: uid(), text: run.hook.text || "How is this tool even legal?", start: 0, end: hookEnd, x: 50, y: TEXT_Y[run.hook.textPos ?? "top"], size: 5.2, font: DEFAULT_FONT, color: "#ffffff", style: "outline" },
      ...(ctaStart !== null ? [{ id: uid(), text: "Link in bio", start: round1(ctaStart), end: round1(total), x: 50, y: 50, size: 4.6, font: DEFAULT_FONT, color: "#ffffff", style: "outline" }] : []),
    ],
  };
}

export const TEXT_Y = { top: 22, center: 50, bottom: 76 } as const;

/** The run's on-screen texts; older runs only have the single hook text. */
export function runTexts(run: Run): TextLayer[] {
  if (run.texts) return run.texts;
  const h = run.hook;
  if (!h.text) return [];
  const len = Math.max(0.5, (h.end ?? 3) - (h.start ?? 0));
  return [
    {
      id: "hook",
      text: h.text,
      start: 0,
      end: Math.round(len * 1000) / 1000,
      x: h.textX ?? 50,
      y: h.textY ?? TEXT_Y[h.textPos ?? "top"],
      size: h.textSize ?? 4.6,
      font: h.font ?? DEFAULT_FONT,
      color: h.color ?? "#ffffff",
      style: h.textStyle ?? "outline",
    },
  ];
}

/** Placeholder people for the not-yet-connected AI avatar step. */
export const AVATAR_TONES: [string, string][] = [
  ["#e2e8f0", "#94a3b8"],
  ["#e5e7eb", "#9ca3af"],
  ["#e7e5e4", "#a8a29e"],
  ["#dbe4ee", "#8796a8"],
  ["#e4e4e7", "#a1a1aa"],
  ["#e9e6e2", "#a39d96"],
];
