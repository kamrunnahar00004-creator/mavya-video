import type { Clip, Project, Reference, Run, Slot, TextLayer } from "@/lib/types";

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

export async function uploadFile(file: File, asAsset: boolean): Promise<{ mediaId: string; mime: string }> {
  const form = new FormData();
  form.append("file", file);
  if (asAsset) form.append("asset", "1");
  const res = await fetch("/api/media", { method: "POST", body: form });
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

/** Turns an uploaded file into a clip ready for a slot. */
export async function clipFromFile(file: File): Promise<Clip> {
  const { mediaId } = await uploadFile(file, true);
  const kind = file.type.startsWith("image/") ? "image" : "video";
  return { mediaId, name: file.name, kind, offset: 0, length: kind === "video" ? await videoLength(mediaId) : null };
}

export async function clipFromAsset(asset: { mediaId: string; name: string; kind: "video" | "image" }): Promise<Clip> {
  return { mediaId: asset.mediaId, name: asset.name, kind: asset.kind, offset: 0, length: asset.kind === "video" ? await videoLength(asset.mediaId) : null };
}

type PendingSave = { patch: Partial<Run>; timer: ReturnType<typeof setTimeout>; done: ((run: Run | null) => void)[] };
const pendingSaves = new Map<string, PendingSave>();
const saveChains = new Map<string, Promise<Run | null>>();

/** Save status per run, for the "Saved" label: saving, saved, or error (a server or network failure is retried). */
export type SaveState = "idle" | "saving" | "saved" | "error";
const saveStates = new Map<string, SaveState>();
const saveListeners = new Set<() => void>();
function setSaveState(id: string, state: SaveState) {
  if (saveStates.get(id) === state) return;
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

function flushRun(id: string) {
  const pending = pendingSaves.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingSaves.delete(id);
  // retry: a server or network failure (a rejected edit, 4xx, would fail again the same way).
  let retry = false;
  const operation = (saveChains.get(id) ?? Promise.resolve(null)).then(async () => {
    try {
      const body = JSON.stringify(pending.patch);
      // Browsers reject keepalive bodies above their 64 KiB quota, even on an open page.
      const keepalive = new TextEncoder().encode(body).byteLength < 60000;
      const res = await fetch(`/api/runs/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body, keepalive });
      if (res.ok) return (await res.json()) as Run;
      retry = res.status >= 500;
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
    if (run) {
      if (!pendingSaves.has(id) && !saveChains.has(id)) setSaveState(id, "saved");
      return;
    }
    setSaveState(id, "error");
    if (!retry) return;
    // Try again in 3 s, under any newer edit (the newer values win).
    const newer = pendingSaves.get(id);
    if (newer) newer.patch = { ...pending.patch, ...newer.patch };
    else pendingSaves.set(id, { patch: pending.patch, done: [], timer: setTimeout(() => flushRun(id), 3000) });
  });
}

/** Keep live edits immediate, merge input bursts, and send writes in order per run. */
export function patchRun(id: string, patch: Partial<Run>): Promise<Run | null> {
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
      { id: uid(), text: run.hook.text || "How is this tool even legal?", start: 0, end: hookEnd, x: 50, y: TEXT_Y[run.hook.textPos ?? "top"], size: 5.2, font: "Arial", color: "#ffffff", style: "outline" },
      ...(ctaStart !== null ? [{ id: uid(), text: "Link in bio", start: round1(ctaStart), end: round1(total), x: 50, y: 50, size: 4.6, font: "montserrat" as const, color: "#6c47ff", style: "box" as const }] : []),
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
      end: round1(len),
      x: h.textX ?? 50,
      y: h.textY ?? TEXT_Y[h.textPos ?? "top"],
      size: h.textSize ?? 4.6,
      font: h.font ?? "Arial",
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
