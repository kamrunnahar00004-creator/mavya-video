"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowLeftRight, Check, ChevronDown, ClipboardPaste, Copy, Diamond, Download, Eye, Film, FolderOpen, GripVertical, Heart, Link as LinkIcon, ListOrdered, Loader2, Magnet, Music, Pause, PenLine, Play, Plus, Redo2, RefreshCw, Scissors, SlidersHorizontal, Smartphone, Smile, Undo2, Volume1, Volume2, VolumeX, Sparkles, Trash2, Type, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { frameAt } from "@/lib/filmstrip";
import { waveform } from "@/lib/waveform";
import { analyzeVideo } from "@/lib/analyze";
import { CHARACTERS, characterById } from "@/lib/characters";
import { FONT_CHOICES, fontCss, fontLabel, loadFonts } from "@/lib/studio-data";
import { ADJUST_ROWS, type Adjust, type AdjustRow, type Motion, NO_ADJUST, fullAdjust, isAdjusted, keyAt, motionAt, moveKey, panBy, setMotion, speedOf, toggleKey, videoStyle } from "@/lib/adjust";
import { audioLength, pieceEnd, refSoundSrc, rowBounds, rowOf, soundName, soundPieces, soundRows } from "@/lib/sound";
import type { Song } from "@/app/api/songs/route";
import { type Seg, clipSrc, demoClips, fileAt, moveClipPiece, removeDemoClip, segAt, videoLength, pieceSpans, relAt, remapTexts, retimeTexts, runSteps, shotList, storeParts, timeline } from "@/lib/edit";
import { STYLE_GROUPS, STYLE_PRESETS, autoSecond, stylePreset } from "@/lib/text-styles";
import { AVATAR_TONES, TEXT_Y, clipFromFile, flushRunSaves, patchRun, remixHook, round1, runTexts, uid, uploadFile } from "@/lib/client";
import { PLATFORM_LABEL, commentCta, fmtTime, fmtViews, isLikelyBoosted, type DemoClip, type Frame, type Part, type Reference, type SoundPiece, type Run, type TextLayer, type TextPos } from "@/lib/types";
import { AvatarPlaceholder } from "@/components/frames";
import { HistoryPanel } from "@/components/history-panel";
import { RunPreview, SyncedAudio, SyncedVideo, TextOverlay, WarmthFilter, claimPlayback, soundAt, usePlaybackClaims } from "@/components/run-preview";

const PRODUCT_KEY = "mavya-product-v1";
type ProductInfo = { name: string; audience: string };
type Hook = Run["hook"];

function loadProduct(): ProductInfo {
  try {
    const raw = localStorage.getItem(PRODUCT_KEY);
    if (raw) return JSON.parse(raw) as ProductInfo;
  } catch {
    // Ignore unreadable storage.
  }
  return { name: "", audience: "" };
}

/** Steps 2 and 3 are hidden while step 1 is built on its own. */
const LATER_STEPS = false as boolean;

const FRAMES: { id: Frame; label: string }[] = [
  { id: "laptop", label: "Phone filming laptop" },
  { id: "none", label: "Full screen" },
  { id: "overlay", label: "Creator corner" },
];

export function RunView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Steps the user opened or closed by hand (undefined = follow progress: just the current step). */
  const [picked, setPicked] = useState<number[] | undefined>(undefined);
  /** Upload: the video is in, waiting for "Use this hook". */
  const [staged, setStaged] = useState<Reference | null>(null);
  const [reading, setReading] = useState(false);
  const [libraryKey, setLibraryKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  /** The full editor (Edit under the phone) is open. */
  const [editing, setEditing] = useState(false);
  const runRef = useRef<Run | null>(null);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    let alive = true;
    Promise.all([fetch(`/api/runs/${id}`), fetch("/api/references?view=studio")])
      .then(async ([r, rs]) => {
        if (!r.ok) throw new Error("missing");
        const runData = (await r.json()) as Run;
        const refData = (await rs.json()) as Reference[];
        if (!alive) return;
        setRun(runData);
        setRefs(refData);
      })
      .catch(() => alive && setMissing(id));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const save = useCallback(
    (patch: Partial<Run>) => {
      setRun((r) => (r?.id === id ? { ...r, ...patch, project: null } : r));
      void patchRun(id, { ...patch, project: null });
    },
    [id]
  );

  /** Text edits from the preview: applied live, saved shortly after (coalesced). */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTexts = useCallback((fn: (t: TextLayer[]) => TextLayer[]) => setRun((r) => {
    if (!r) return r;
    const texts = fn(runTexts(r));
    const h = texts.find((x) => x.id === "hook");
    return { ...r, texts, hook: h ? { ...r.hook, text: h.text } : r.hook };
  }), []);
  const commitTexts = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const cur = runRef.current;
      if (!cur) return;
      const texts = runTexts(cur);
      const h = texts.find((x) => x.id === "hook");
      void patchRun(id, { texts, hook: h ? { ...cur.hook, text: h.text } : cur.hook, project: null });
    }, 250);
  }, [id]);

  /** Advanced settings of one clip ("hook" or a demo clip id): applied live, saved shortly after. Speed re-times the texts. */
  const adjustTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveAdjust = useCallback(
    (clipId: string, adjust: Partial<Adjust>) => {
      setRun((r) => {
        if (!r) return r;
        const seg = timeline(r, null).find((x) => x.id === clipId);
        if (!seg) return r;
        const before = speedOf(seg.adjust);
        const after = speedOf(adjust);
        const texts = before === after ? runTexts(r) : remapTexts(runTexts(r), seg.offset, { parts: seg.parts, speed: before }, { parts: seg.parts, speed: after });
        const next = clipId === "hook" ? { ...r, hook: { ...r.hook, adjust } } : { ...r, demo: { ...r.demo, clips: demoClips(r).map((c) => (c.id === clipId ? { ...c, adjust } : c)) } };
        return { ...next, texts };
      });
      if (adjustTimer.current) clearTimeout(adjustTimer.current);
      adjustTimer.current = setTimeout(() => {
        adjustTimer.current = null;
        const cur = runRef.current;
        if (cur) void patchRun(id, { hook: cur.hook, demo: cur.demo, texts: runTexts(cur), project: null });
      }, 250);
    },
    [id]
  );

  useEffect(() => {
    const flush = () => {
      const dirty = saveTimer.current || adjustTimer.current;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (adjustTimer.current) clearTimeout(adjustTimer.current);
      saveTimer.current = adjustTimer.current = null;
      const cur = runRef.current;
      if (dirty && cur?.id === id) void patchRun(id, { hook: cur.hook, demo: cur.demo, texts: runTexts(cur), project: null });
      flushRunSaves();
    };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [id]);

  if (missing === id) {
    return (
      <div className="card flex h-full flex-col items-center justify-center gap-3 text-muted">
        Run not found
        <Link href="/studio" className="font-semibold text-accent">
          Back to runs
        </Link>
      </div>
    );
  }
  if (!run || run.id !== id || !refs) {
    return (
      <div className="card flex h-full items-center justify-center text-soft">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const source = refs.find((r) => r.id === run.sourceRefId) ?? null;
  const hook = run.hook;
  const ready = Boolean(hook.generated) && demoClips(run).some((c) => clipSrc(c));
  const texts = runTexts(run);
  const pickHook = (ref: Reference, from: HookSource = "library") => {
    const seg = ref.analysis?.segments.find((s) => s.role === "hook");
    // Prefill the hook text with the stolen hook's on-screen text, unless the user already wrote their own.
    const base = texts.find((x) => x.id === "hook");
    const stolen = ref.recipe?.onScreenText?.[0]?.text ?? (from === "library" ? ref.title : "");
    const keep = base && base.text && base.text !== DEFAULT_HOOK_TEXT;
    const nextTexts = base && !keep && stolen ? texts.map((x) => (x.id === "hook" ? { ...x, text: stolen } : x)) : texts;
    save({
      sourceRefId: ref.id,
      title: run.title === "Untitled run" || run.title === "Untitled video" ? (ref.author ? `Hook from @${ref.author}` : "Untitled video") : run.title,
      hook: { ...hook, source: from, start: seg?.start ?? 0, end: seg?.end ?? 3, clip: hook.face ? null : hook.clip, text: keep || !stolen ? hook.text : stolen },
      texts: nextTexts,
    });
    setPickerOpen(false);
    setPicked(undefined);
  };
  /** An uploaded reference video: read its cuts in the browser, then use it as the hook source. */
  const takeUpload = async (ref: Reference) => {
    let r = ref;
    try {
      const analysis = await analyzeVideo(`/api/media/${ref.mediaId}`);
      await fetch(`/api/references/${ref.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ analysis }) });
      r = { ...ref, analysis };
    } catch {
      // Still usable without cut detection (default 3s hook).
    }
    setRefs((cur) => [r, ...(cur ?? [])]);
    pickHook(r, "upload");
  };
  const segs = timeline(run, source);
  const videoLen = videoLength(segs);
  const hasDemo = demoClips(run).some((c) => clipSrc(c));
  const stepDone = runSteps(run);
  const current = stepDone.findIndex((d) => !d) + 1 || stepDone.length; // 1-based; all done = last step
  // The open step: the user's choice, else the first unfinished one. Finishing a step clears the choice (moves on).
  const openSteps = picked ?? [current];
  const toggleStep = (n: number) => setPicked(openSteps.includes(n) ? openSteps.filter((x) => x !== n) : [...openSteps, n]);
  const faceName = hook.face?.kind === "character" ? characterById(hook.face.id)?.name : hook.face?.kind === "photo" ? "Your photo" : hook.face?.kind === "described" ? hook.face.text : undefined;
  const stepSummary = [
    (source ? (source.author ? `Hook from @${source.author}` : source.title) : undefined) ?? (hook.source === "describe" && hook.describeReady ? hook.describe : undefined),
    faceName,
    hook.generated ? "Hook ready" : undefined,
    hasDemo ? (run.demo.mode === "clips" ? `${demoClips(run).filter((c) => clipSrc(c)).length} ${demoClips(run).filter((c) => clipSrc(c)).length === 1 ? "clip" : "clips"}` : "Demo added") : undefined,
    soundPieces(run, videoLen).length > 1 ? `${soundPieces(run, videoLen).length} sounds` : soundPieces(run, videoLen)[0]?.name,
  ];

  /* ----- Clip editing, shared by the hook and every demo clip ----- */
  const patchText = (tid: string, patch: Partial<TextLayer>) => {
    liveTexts((t) => t.map((x) => (x.id === tid ? { ...x, ...patch } : x)));
    commitTexts();
  };
  const addText = (afterId: string | null, [ws, we]: [number, number], text = "", template?: TextLayer) => {
    liveTexts((t) => {
      const i = afterId ? t.findIndex((x) => x.id === afterId) : -1;
      // Same look and spot as the subtitle it follows (the row's own "+", else the one before it in the video).
      const base = template ?? t[i] ?? lookBefore(t, ws);
      // Only nudge it down when it would sit on top of that subtitle at the same time.
      const overlaps = base && base.start < we - 0.01 && base.end > ws + 0.01;
      const item: TextLayer = base
        ? { ...base, id: uid(), text, start: ws, end: we, y: overlaps && !template ? Math.min(90, base.y + 12) : base.y }
        : { id: uid(), text, start: ws, end: we, x: 50, y: TEXT_Y.top, size: 4.6, font: "Arial", color: "#ffffff", style: "outline" };
      return i >= 0 ? [...t.slice(0, i + 1), item, ...t.slice(i + 1)] : [...t, item];
    });
    commitTexts();
  };
  /** "Apply to all": every subtitle takes this one's look and position (font, colours, style, size, x, y). */
  const applyTextToAll = (tid: string) => {
    liveTexts((t) => {
      const src = t.find((x) => x.id === tid);
      if (!src) return t;
      return t.map((x) => (x.id === tid ? x : { ...x, font: src.font, color: src.color, style: src.style, second: src.second, size: src.size, x: src.x, y: src.y }));
    });
    commitTexts();
  };
  const removeText = (tid: string) => {
    liveTexts((t) => t.filter((x) => x.id !== tid));
    commitTexts();
  };
  /** A clip's pieces changed (Cut, trim or delete a piece, Undo). Texts follow the same frames; texts only on a deleted piece go with it. */
  const setParts = (clipId: string, parts: Part[], hold = false) => {
    const seg = segs.find((x) => x.id === clipId);
    if (!seg || !parts.length) return;
    const speed = speedOf(seg.adjust);
    // Magnet off (hold): the clip after it stays where it is; the change goes into the empty space before it.
    const after = segs[segs.indexOf(seg) + 1];
    const keep = hold && Boolean(after);
    const newLen = parts.reduce((t, x) => t + Math.max(0.05, x.end - x.start), 0) / speed;
    const fix = (c: DemoClip) => (keep && c.id === after.id ? { ...c, gap: Math.round(Math.max(0, (c.gap ?? 0) + seg.len - newLen) * 1000) / 1000 } : c);
    const spans = pieceSpans(seg);
    let kept = texts;
    for (let i = 0; i < seg.parts.length; i++) {
      if (parts.some((q) => q.id === seg.parts[i].id)) continue;
      const a = seg.offset + spans[i].at;
      const b = a + spans[i].len;
      kept = kept.filter((x) => x.start < a - 0.001 || x.end > b + 0.001);
    }
    const nextTexts = remapTexts(kept, seg.offset, { parts: seg.parts, speed }, { parts, speed }, keep);
    const stored = storeParts(parts);
    if (clipId === "hook") save({ hook: { ...hook, ...stored }, demo: keep ? { ...run.demo, clips: demoClips(run).map(fix) } : run.demo, texts: nextTexts });
    else save({ demo: { ...run.demo, clips: demoClips(run).map((c) => (c.id === clipId ? { ...c, ...stored } : fix(c))) }, texts: nextTexts });
  };
  /** A generated hook goes in (new, or picked from My files with `extra` = the hook and character it was made from).
   *  The hook's length changes: texts follow (a text over the whole hook keeps covering it). The old one is kept in versions. */
  const applyGenerated = (generated: NonNullable<Run["hook"]["generated"]>, text: string, extra: Partial<Run["hook"]> = {}, sourceRefId?: string | null) => {
    const sp = speedOf(hook.adjust);
    const nextSpeed = "adjust" in extra ? speedOf(extra.adjust) : sp;
    const old = segs[0];
    const moved = retimeTexts(texts, 0, { start: 0, end: old.len * sp, speed: sp }, { start: 0, end: generated.seconds, speed: nextSpeed });
    const base = moved.find((x) => x.id === "hook");
    const end = round1(generated.seconds / nextSpeed);
    const item: TextLayer = base
      ? { ...base, text: base.text && base.text !== DEFAULT_HOOK_TEXT ? base.text : text }
      : { id: "hook", text, start: 0, end, x: 50, y: TEXT_Y.top, size: 4.6, font: "Arial", color: "#ffffff", style: "outline" };
    const versions = hook.generated && (hook.generated.src !== generated.src || hook.generated.at !== generated.at) ? [...(hook.versions ?? []), hook.generated].slice(-50) : hook.versions;
    save({
      ...(sourceRefId !== undefined ? { sourceRefId } : {}),
      hook: { ...hook, ...extra, generated, versions, start: 0, end: generated.seconds, parts: undefined, text: item.text },
      texts: [item, ...moved.filter((x) => x.id !== "hook")],
    });
  };
  const clipEditor = (seg: Seg) => (
    <ClipEditor
      key={seg.id}
      seg={seg}
      texts={texts}
      onParts={(parts) => setParts(seg.id, parts)}
      onAdjust={(a) => liveAdjust(seg.id, a)}
      onPatch={patchText}
      onAdd={addText}
      onRemove={removeText}
      onApplyAll={applyTextToAll}
    />
  );

  /* ----- Step 4: demo clips ----- */
  /** A text over one clip in the same look and spot as the subtitle before it in the video, so the video keeps one text style. */
  const textOver = (all: TextLayer[], text: string, at: number, len: number): TextLayer => {
    const look = lookBefore(all, at);
    const span = { start: round1(at), end: round1(at + len) };
    return look ? { ...look, id: uid(), text, ...span } : { id: uid(), text, ...span, x: 50, y: TEXT_Y.top, size: 4.6, font: "Arial", color: "#ffffff", style: "outline" };
  };
  /** Puts an uploaded video into a demo clip. Texts after it move later by its length (or by the change, when replacing). */
  const fillClip = async (clipId: string, file: File, startClips?: DemoClip[], mode?: "single" | "clips") => {
    const c = await clipFromFile(file);
    setLibraryKey((k) => k + 1);
    const cur = runRef.current ?? run;
    if (cur.id !== id) return;
    const seconds = round1(c.length ?? 3);
    const list = startClips ?? demoClips(cur);
    const clips = list.map((x) => (x.id === clipId ? { ...x, src: undefined, mediaId: c.mediaId ?? undefined, name: c.name, seconds, start: 0, end: seconds, parts: undefined, adjust: undefined } : x));
    const before = timeline(cur, null);
    const old = before.find((x) => x.id === clipId);
    const nextRun: Run = { ...cur, demo: { ...cur.demo, mode: mode ?? cur.demo.mode ?? "single", clips } };
    const now = timeline(nextRun, null).find((x) => x.id === clipId);
    let nextTexts = runTexts(cur);
    if (now && old) {
      nextTexts = retimeTexts(nextTexts, old.offset, { start: 0, end: old.len, speed: 1 }, { start: 0, end: now.len, speed: 1 });
    } else if (now) {
      const by = now.len - (old?.len ?? 0);
      nextTexts = nextTexts.map((t) => (t.start >= now.offset - 0.05 ? { ...t, start: round1(t.start + by), end: round1(t.end + by) } : t.end > now.offset + 0.05 && !old ? { ...t, end: round1(t.end + by) } : t));
    }
    // First video for a shot-list clip: its suggested text goes on screen over it, styled like the hook text (editable like any text).
    const suggested = list.find((x) => x.id === clipId)?.text;
    if (now && !old && suggested) nextTexts = [...nextTexts, textOver(nextTexts, suggested, now.offset, now.len)];
    save({ demo: nextRun.demo, texts: nextTexts });
  };
  /** "Upload your demo" with one or more videos: one = a single demo, several = clips 1..N in file-name order (IMG_001, IMG_002...).
   *  `at` = insert before this demo clip (the editor's + Clips at the playhead); default at the end. Texts from there on move later. */
  const addVideos = async (files: File[], at?: number) => {
    const sorted = [...files].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
    const ups = await Promise.all(sorted.map((f) => clipFromFile(f)));
    setLibraryKey((k) => k + 1);
    const count = demoClips(runRef.current ?? run).length;
    const added: DemoClip[] = ups.map((c, i) => {
      const seconds = round1(c.length ?? 3);
      return { id: uid(), label: `Clip ${count + i + 1}`, mediaId: c.mediaId ?? undefined, name: c.name, seconds, start: 0, end: seconds };
    });
    insertClips(added, at);
  };
  /** Puts demo clips in before demo clip `at` (default: the end). Texts from there on move later by their length. */
  const insertClips = (added: DemoClip[], at?: number) => {
    const cur = runRef.current ?? run;
    if (cur.id !== id) return;
    // A single demo turning into clips: "Your demo" becomes "Clip 1".
    const before = demoClips(cur).map((c) => (added.length && c.label === "Your demo" ? { ...c, label: "Clip 1" } : c));
    const pos = at === undefined ? before.length : Math.max(0, Math.min(before.length, at));
    const clips = [...before.slice(0, pos), ...added, ...before.slice(pos)];
    const nextRun: Run = { ...cur, demo: { ...cur.demo, mode: clips.length > 1 ? "clips" : "single", clips } };
    // Texts from the insert point on move later by the new clips' length (at the end, nothing moves).
    const old = timeline(cur, null);
    const next = before.slice(pos).map((c) => old.find((g) => g.id === c.id)).find(Boolean);
    const from = next ? next.offset : Infinity;
    const by = timeline(nextRun, null).filter((g) => added.some((c) => c.id === g.id)).reduce((t, g) => t + g.gap + g.len, 0);
    const r = (x: number) => Math.round(x * 1000) / 1000;
    save({ demo: nextRun.demo, texts: runTexts(cur).map((x) => (x.start >= from - 0.05 ? { ...x, start: r(x.start + by), end: r(x.end + by) } : x)) });
  };
  /** Move a demo clip to position `to`. Texts that sit on that clip (or any moved clip) go with it; texts across several clips keep their time. */
  const moveClip = (clipId: string, to: number) => {
    const clips = demoClips(run);
    const from = clips.findIndex((c) => c.id === clipId);
    if (from < 0 || to < 0 || to >= clips.length || to === from) return;
    const next = [...clips];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const before = timeline(run, null);
    const after = timeline({ ...run, demo: { ...run.demo, clips: next } }, null);
    const nextTexts = texts.map((x) => {
      const home = before.find((g) => g.id !== "hook" && x.start >= g.offset - 0.01 && x.end <= g.offset + g.len + 0.01);
      const now = home && after.find((g) => g.id === home.id);
      if (!home || !now) return x;
      const d = now.offset - home.offset;
      return d ? { ...x, start: Math.round((x.start + d) * 1000) / 1000, end: Math.round((x.end + d) * 1000) / 1000 } : x;
    });
    save({ demo: { ...run.demo, mode: run.demo.mode ?? "clips", clips: next }, texts: nextTexts });
  };
  /** Editor drag: a clip goes just before clip `beforeId` (null = the end). A piece of a Cut clip becomes its own clip there. */
  const moveClipTo = (segId: string, partId: string, beforeId: string | null) => {
    const patch = moveClipPiece(run, texts, segId, partId, beforeId, uid());
    if (patch) save(patch);
  };
  const deleteClip = (clipId: string, hold = false) => save(removeDemoClip(run, clipId, texts, hold));
  /** Magnet off: put a demo clip at timeline time `to`, between its neighbours (the clip after it stays). Texts only on it move with it. */
  const shiftClip = (clipId: string, to: number) => {
    const i = segs.findIndex((x) => x.id === clipId);
    const seg = segs[i];
    if (!seg || i <= 0) return;
    const prevEnd = segs[i - 1].offset + segs[i - 1].len;
    const next = segs[i + 1];
    const at = Math.max(prevEnd, next ? Math.min(to, next.offset - seg.len) : to);
    const d = at - seg.offset;
    if (Math.abs(d) < 0.01) return;
    const r = (x: number) => Math.round(x * 1000) / 1000;
    const clips = demoClips(run).map((c) => (c.id === clipId ? { ...c, gap: r(at - prevEnd) } : next && c.id === next.id ? { ...c, gap: r(next.offset - (at + seg.len)) } : c));
    save({ demo: { ...run.demo, clips }, texts: texts.map((x) => (x.id !== "hook" && x.start >= seg.offset - 0.05 && x.end <= seg.offset + seg.len + 0.05 ? { ...x, start: r(x.start + d), end: r(x.end + d) } : x)) });
  };
  /** Magnet back on: every empty space closes; texts after it move up with the clips. */
  const closeGaps = () => {
    const r = (x: number) => Math.round(x * 1000) / 1000;
    let next = texts;
    for (const g of [...segs].reverse()) {
      if (!g.gap) continue;
      const from = g.offset - g.gap;
      const m = (v: number) => (v >= g.offset - 0.05 ? v - g.gap : v > from ? from : v);
      next = next.map((x) => {
        const start = r(m(x.start));
        return { ...x, start, end: r(Math.max(start + 0.3, m(x.end))) };
      });
    }
    save({ demo: { ...run.demo, clips: demoClips(run).map((c) => (c.gap ? { ...c, gap: undefined } : c)) }, texts: next });
  };
  const resetDemo = () => {
    if (hasDemo && !confirm("Remove your demo clips?")) return;
    save({ demo: { ...run.demo, clip: null, mode: undefined, clips: [] }, texts });
  };
  const resetHook = () => save({ sourceRefId: null, hook: { ...hook, source: undefined } });
  /** Applies a change to the hook text item (if the user kept it). */
  const withHookText = (p: Partial<TextLayer>) => texts.map((x) => (x.id === "hook" ? { ...x, ...p } : x));

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <Link href="/studio" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-muted hover:bg-raised hover:text-text">
          <ArrowLeft className="h-4 w-4" />
          Videos
        </Link>
        <TitleInput value={run.title === "Untitled run" ? "Untitled video" : run.title} onSave={(title) => save({ title })} />
        <button type="button" onClick={() => setLibraryOpen(true)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-muted hover:bg-raised hover:text-text">
          <FolderOpen className="h-4 w-4" />
          My files
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!confirm("Delete this run?")) return;
            await fetch(`/api/runs/${run.id}`, { method: "DELETE" });
            router.push("/studio");
          }}
          className="rounded-lg p-2 text-soft hover:bg-raised hover:text-text"
          aria-label="Delete video"
          title="Delete video"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={!ready}
          title={ready ? undefined : "Generate the hook and add a demo first"}
          onClick={() => setToast("Rendering is not connected yet.")}
          className="btn-primary ml-1 px-4 py-2 text-[14px]"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </header>

      {pickerOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-6" onClick={() => setPickerOpen(false)}>
          <div className="fade-in flex h-full max-h-[880px] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_64px_rgba(15,23,42,0.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5">
              <h2 className="text-[18px] font-extrabold tracking-tight">Choose a hook</h2>
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
              <SourcePicker refs={refs} source={null} onRefsChange={setRefs} onPick={pickHook} onClear={() => undefined} />
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:grid xl:grid-cols-[minmax(0,1fr)_400px] xl:overflow-hidden">
        <div className="shrink-0 xl:min-h-0 xl:overflow-y-auto">
          <div className="mx-auto max-w-[760px] divide-y divide-line px-8">
            <Block n={1} title="Steal a hook that already works" done={stepDone[0]} open={openSteps.includes(1)} summary={stepSummary[0]} onToggle={() => toggleStep(1)}>
              {!source && hook.source === "describe" && hook.describeReady && hook.describe?.trim() ? (
                <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-[22px] font-black leading-none text-accent">&ldquo;</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-soft">Your hook</div>
                    <div className="text-[14.5px] font-semibold">{hook.describe}</div>
                  </div>
                  <button type="button" onClick={() => save({ hook: { ...hook, describeReady: false } })} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
                    Change
                  </button>
                </div>
              ) : source ? (
                <>
                  <SourcePicker refs={refs} source={source} onRefsChange={setRefs} onPick={pickHook} onClear={resetHook} />
                  {hook.source === "upload" && (
                    <NoteField
                      label="Additional context (optional)"
                      placeholder="What to keep or change, e.g. keep the shocked face, make it about my budgeting app"
                      value={hook.note ?? ""}
                      onSave={(note) => save({ hook: { ...hook, note } })}
                    />
                  )}
                </>
              ) : (
                // One box: the library is the main path; upload and describe open right below, on the same page.
                <div className="rounded-2xl border border-line bg-panel">
                  <div className="flex flex-wrap items-center gap-2.5 p-4">
                    <button type="button" onClick={() => setPickerOpen(true)} className="btn-primary px-4 py-2.5 text-[14px]">
                      Browse hooks
                    </button>
                    {(["upload", "describe"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={hook.source === m}
                        onClick={() => save({ hook: { ...hook, source: hook.source === m ? undefined : m } })}
                        className={optionBtn(hook.source === m)}
                      >
                        {m === "upload" ? <Upload className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
                        {m === "upload" ? "Upload a video" : "Describe your own"}
                      </button>
                    ))}
                  </div>
                  {hook.source === "upload" && (
                    <div className="space-y-3 border-t border-line p-4">
                      {staged ? (
                        <div className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                          <video src={`/api/media/${staged.mediaId}#t=0.5`} muted preload="metadata" className="h-[72px] w-[42px] rounded-md bg-ink object-cover" />
                          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{staged.title}</span>
                          <button type="button" onClick={() => setStaged(null)} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
                            Replace
                          </button>
                        </div>
                      ) : (
                        <UploadDrop onAdded={setStaged} />
                      )}
                      <NoteField
                        label="Additional context (optional)"
                        placeholder="What to keep or change, e.g. keep the shocked face, make it about my budgeting app"
                        value={hook.note ?? ""}
                        onSave={(note) => save({ hook: { ...hook, note } })}
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={!staged || reading}
                          onClick={async () => {
                            if (!staged) return;
                            setReading(true);
                            await takeUpload(staged);
                            setReading(false);
                            setStaged(null);
                          }}
                          className="btn-primary px-4 py-2.5 text-[14px] disabled:opacity-50"
                        >
                          {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Use this hook"}
                        </button>
                      </div>
                    </div>
                  )}
                  {hook.source === "describe" && (
                    <div className="border-t border-line p-4">
                      <NoteField
                        label="Describe your hook"
                        placeholder="e.g. I spit out my coffee looking at my laptop, then point at the screen"
                        value={hook.describe ?? ""}
                        rows={3}
                        onSave={(describe) => save({ hook: { ...hook, describe } })}
                        chips={["Spit-take at the laptop, then point at the screen", "Jaw drop, cover mouth, look back at the laptop", "Slow turn to camera with a smug smile"]}
                        submitLabel="Use this hook"
                        onSubmit={(describe) => save({ hook: { ...hook, source: "describe", describe, describeReady: true } })}
                      />
                    </div>
                  )}
                </div>
              )}
              {source?.analysis && <HookTiming duration={source.analysis.duration} start={hook.start ?? 0} end={hook.end ?? 3} onChange={(start, end) => save({ hook: { ...hook, start, end } })} />}
            </Block>

            <Block n={2} title="Choose your character" done={stepDone[1]} open={openSteps.includes(2)} summary={stepSummary[1]} onToggle={() => toggleStep(2)}>
              <CharacterStep
                face={hook.face ?? null}
                mode={hook.faceMode}
                onMode={(faceMode) => save({ hook: { ...hook, faceMode } })}
                onFace={(face) => {
                  save({ hook: { ...hook, face } });
                  setPicked(undefined);
                }}
              />
            </Block>

            <Block n={3} title="Generate your hook" done={stepDone[2]} open={openSteps.includes(3)} summary={stepSummary[2]} onToggle={() => toggleStep(3)}>
              <GenerateStep
                run={run}
                source={source}
                seg={segs[0]}
                texts={texts}
                onGenerated={(generated, text) => applyGenerated(generated, text)}
                onPatch={patchText}
                onAdd={addText}
                onAdjust={(a) => liveAdjust("hook", a)}
                onParts={(parts) => setParts("hook", parts)}
                onApplyAll={applyTextToAll}
                onRemove={removeText}
              />
            </Block>

            <Block n={4} title="Add your demo" done={stepDone[3]} open={openSteps.includes(4)} summary={stepSummary[3]} onToggle={() => toggleStep(4)}>
              <DemoStep
                run={run}
                segs={segs}
                renderEditor={clipEditor}
                onFiles={async (files) => {
                  setPicked((p) => Array.from(new Set([...(p ?? openSteps), 4])));
                  await addVideos(files);
                }}
                onClips={() => save({ demo: { ...run.demo, mode: "clips", clips: shotList(source).map((x) => ({ ...x, id: uid() })) } })}
                onUpload={async (cid, f) => {
                  setPicked((p) => Array.from(new Set([...(p ?? openSteps), 4])));
                  await fillClip(cid, f);
                }}
                onRename={(cid, label) => save({ demo: { ...run.demo, clips: demoClips(run).map((c) => (c.id === cid ? { ...c, label } : c)) } })}
                onDelete={deleteClip}
                onMove={moveClip}
                onReset={resetDemo}
              />
            </Block>

            <Block n={5} title="Add sound" done={stepDone[4]} open={openSteps.includes(5)} summary={stepSummary[4]} onToggle={() => toggleStep(5)}>
              <SoundStep run={run} source={source} segs={segs} texts={texts} videoLen={videoLen} onPieces={(sounds) => save({ sounds, sound: null })} />
            </Block>

            {LATER_STEPS && (
              <>
            <Block n={2} title="Make it about your product" done={Boolean(hook.face || hook.clip) && Boolean(hook.text)}>
              <FacePicker
                face={hook.face ?? null}
                hasOwnClip={Boolean(hook.clip)}
                onFace={(face) => save({ hook: { ...hook, face, clip: null } })}
                onOwnClip={async (f) => {
                  const clip = await clipFromFile(f);
                  setLibraryKey((k) => k + 1);
                  save({ hook: { ...hook, clip, face: null } });
                }}
              />
              <HookText
                run={run}
                onChange={(patch) => {
                  const p: Partial<TextLayer> = {};
                  if (patch.text !== undefined) p.text = patch.text;
                  if (patch.textPos) Object.assign(p, { x: 50, y: TEXT_Y[patch.textPos] });
                  let next = Object.keys(p).length ? withHookText(p) : texts;
                  // A hook text typed after the hook item was deleted brings it back.
                  if (patch.text && !next.some((x) => x.id === "hook")) next = [...next, ...runTexts({ ...run, texts: undefined, hook: { ...hook, ...patch } })];
                  save({ hook: { ...hook, ...patch }, texts: next });
                }}
              />
            </Block>

            <Block n={3} title="Show what it does" done={Boolean(run.demo.clip)}>
              <DemoPicker
                run={run}
                onClip={async (f) => {
                  const clip = await clipFromFile(f);
                  setLibraryKey((k) => k + 1);
                  save({ demo: { ...run.demo, clip } });
                }}
                onClear={() => save({ demo: { ...run.demo, clip: null } })}
                onFrame={(frame) => save({ demo: { ...run.demo, frame } })}
              />
            </Block>
              </>
            )}
          </div>
        </div>

        <aside className="flex shrink-0 flex-col items-center justify-center border-l border-line bg-raised p-6 xl:min-h-0 xl:overflow-y-auto">
          <RunPreview run={run} source={source} texts={texts} />
          <button
            type="button"
            onClick={() => {
              claimPlayback("editor");
              setEditing(true);
            }}
            className={`${optionBtn(false)} mt-4`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Edit video
          </button>
        </aside>
      </div>

      {libraryOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 bg-black/20" onClick={() => setLibraryOpen(false)}>
          <div className="absolute bottom-3 right-3 top-3" onClick={(e) => e.stopPropagation()}>
            <HistoryPanel
              run={run}
              refs={refs}
              refreshKey={libraryKey}
              onClose={() => setLibraryOpen(false)}
              onUseHook={(r) => {
                pickHook(r, r.owner === "user" ? "upload" : "library");
                setLibraryOpen(false);
                setToast("Hook replaced");
              }}
              onUseFace={(face) => {
                save({ hook: { ...hook, face, faceMode: undefined } });
                setLibraryOpen(false);
                setToast("Character replaced");
              }}
              onUseGenerated={(g, from) => {
                // Steps 1 to 3 fill from the video it was made in: its viral hook, its character, and this generated hook.
                applyGenerated(g, from.hook.text || hook.text, { face: from.hook.face ?? hook.face, source: from.hook.source, describe: from.hook.describe, describeReady: from.hook.describeReady, adjust: from.hook.adjust }, from.sourceRefId);
                setPicked(undefined);
                setLibraryOpen(false);
                setToast("Hook replaced");
              }}
              onUseDemo={(clips) => {
                // The demo is replaced by that one, clips as they were cut (empty spaces left out).
                const copy = clips.map((c) => ({ ...c, id: uid(), gap: undefined }));
                save({ demo: { ...run.demo, clip: null, mode: copy.length > 1 ? "clips" : "single", clips: copy }, texts });
                setLibraryOpen(false);
                setToast("Demo replaced");
              }}
              onUseSound={(p) => {
                // The sound is replaced by this one, under the whole video.
                save({ sounds: [{ ...p, id: uid(), at: 0, end: videoLen, row: 0 }], sound: null });
                setLibraryOpen(false);
                setToast("Sound replaced");
              }}
            />
          </div>
        </div>
      )}

      {editing && (
        <VideoEditor
          run={run}
          source={source}
          segs={segs}
          texts={texts}
          videoLen={videoLen}
          onClose={() => setEditing(false)}
          onRestore={(x) => save({ hook: x.hook, demo: x.demo, texts: x.texts, sounds: x.sounds, sound: null })}
          onParts={setParts}
          onDeleteClip={deleteClip}
          onAddVideos={addVideos}
          onInsertClip={(clip, at) => insertClips([clip], at)}
          onMoveClip={moveClipTo}
          onShiftClip={shiftClip}
          onCloseGaps={closeGaps}
          onAdjust={liveAdjust}
          onPatchText={patchText}
          onAddText={addText}
          onRemoveText={removeText}
          onApplyAll={applyTextToAll}
          onPieces={(sounds) => save({ sounds, sound: null })}
        />
      )}

      {toast && <div className="fade-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-text px-4 py-2.5 text-[13.5px] font-semibold text-bg shadow-lg">{toast}</div>}
    </div>
  );
}

/* ---------------- Layout pieces ---------------- */

function TitleInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() && draft !== value && onSave(draft.trim())}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-[16px] font-bold outline-none hover:bg-raised focus:bg-raised"
      aria-label="Run title"
    />
  );
}

/** Step 2, same pattern as step 1: browse the cast (overlay), or upload a photo / describe a character (inline). */
function CharacterStep({ face, mode, onMode, onFace }: { face: Hook["face"] | null; mode?: "upload" | "describe"; onMode: (m: "upload" | "describe" | undefined) => void; onFace: (f: Hook["face"]) => void }) {
  const [browsing, setBrowsing] = useState(false);
  const [staged, setStaged] = useState<string | null>(null); // uploaded photo, waiting for "Use this character"
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  async function upload(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(jpeg|png)$/.test(f.type)) return setError("Use a JPG or PNG photo");
    setBusy(true);
    setError(null);
    try {
      setStaged((await uploadFile(f, true)).mediaId);
    } catch {
      setError("Could not upload this photo");
    } finally {
      setBusy(false);
    }
  }

  const pick = (f: Hook["face"]) => {
    onFace(f);
    setBrowsing(false);
    setStaged(null);
    setChanging(false);
  };

  // Chosen: compact row with Change.
  if (face && !changing) {
    const c = face.kind === "character" ? characterById(face.id) : null;
    return (
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-3">
        {face.kind === "described" ? (
          <span className="flex h-[72px] w-[54px] shrink-0 items-center justify-center rounded-lg bg-accent-tint text-[22px] font-black text-accent">&ldquo;</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c ? c.thumb : face.kind === "photo" ? `/api/media/${face.mediaId}` : ""} alt="" className="h-[72px] w-[54px] shrink-0 rounded-lg object-cover object-top" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-soft">{c ? "Character" : face.kind === "photo" ? "Your photo" : "Your character"}</div>
          <div className="truncate text-[15px] font-bold">{c ? c.name : face.kind === "described" ? face.text : "Uploaded photo"}</div>
        </div>
        <button type="button" onClick={() => setChanging(true)} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2.5 p-4">
        <button type="button" onClick={() => setBrowsing(true)} className="btn-primary px-4 py-2.5 text-[14px]">
          Browse characters
        </button>
        {(["upload", "describe"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(mode === m ? undefined : m)} className={optionBtn(mode === m)}>
            {m === "upload" ? <Upload className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
            {m === "upload" ? "Upload a photo" : "Describe your character"}
          </button>
        ))}
      </div>

      {mode === "upload" && (
        <div className="space-y-3 border-t border-line p-4">
          {staged ? (
            <div className="flex items-center gap-3 rounded-xl border border-line p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/media/${staged}`} alt="" className="h-[72px] w-[54px] rounded-md object-cover" />
              <span className="flex-1 text-[14px] font-semibold">Your photo</span>
              <button type="button" onClick={() => setStaged(null)} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
                Replace
              </button>
            </div>
          ) : (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void upload(e.dataTransfer.files[0]);
              }}
              className={`flex h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-colors ${drag ? "border-accent bg-accent-tint" : "border-line-strong hover:border-accent hover:bg-accent-tint/40"} ${busy ? "pointer-events-none" : ""}`}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-tint text-accent">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}</span>
              <span className="text-[15px] font-bold">{busy ? "Uploading" : "Drop a photo or click to upload"}</span>
              {!busy && <span className="text-[12.5px] text-soft">A clear photo of the face, JPG or PNG</span>}
              <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
            </label>
          )}
          {error && <p className="text-[13px] text-red-500">{error}</p>}
          <div className="flex justify-end">
            <button type="button" disabled={!staged} onClick={() => staged && pick({ kind: "photo", mediaId: staged })} className="btn-primary px-4 py-2.5 text-[14px] disabled:opacity-50">
              Use this character
            </button>
          </div>
        </div>
      )}

      {mode === "describe" && (
        <div className="border-t border-line p-4">
          <NoteField
            label="Describe your character"
            placeholder="e.g. a woman in her late 20s with curly red hair, a green sweater, in a cozy home office"
            value={face?.kind === "described" ? face.text : ""}
            rows={3}
            onSave={() => undefined}
            chips={["A woman in her 20s with long dark hair and a hoodie", "A guy in his 30s with a beard and glasses", "A student in a dorm room with headphones"]}
            submitLabel="Use this character"
            onSubmit={(text) => pick({ kind: "described", text })}
          />
        </div>
      )}

      {browsing && <CharacterBrowser current={face} onPick={(id) => pick({ kind: "character", id })} onClose={() => setBrowsing(false)} />}
    </div>
  );
}

/** Overlay with the whole cast; click a face for the large view, then "Use <name>". */
function CharacterBrowser({ current, onPick, onClose }: { current: Hook["face"] | null; onPick: (id: string) => void; onClose: () => void }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const shown = viewing === null ? null : CHARACTERS[viewing];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewing === null) onClose();
        else setViewing(null);
      }
      if (viewing === null) return;
      if (e.key === "ArrowRight") setViewing((viewing + 1) % CHARACTERS.length);
      if (e.key === "ArrowLeft") setViewing((viewing - 1 + CHARACTERS.length) % CHARACTERS.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, onClose]);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
      <div className="fade-in flex h-full max-h-[880px] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_64px_rgba(15,23,42,0.25)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-[18px] font-extrabold tracking-tight">Choose your character</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3">
            {CHARACTERS.map((c, i) => {
              const on = current?.kind === "character" && current.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setViewing(i)}
                  className={`group relative aspect-[3/4] overflow-hidden rounded-xl border-2 transition-[border-color,box-shadow] ${on ? "border-accent" : "border-transparent hover:border-line-strong"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.thumb} alt={c.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover object-top" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-left text-[12.5px] font-bold text-white">{c.name}</span>
                  {on && (
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {shown && viewing !== null && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6" onClick={(e) => { e.stopPropagation(); setViewing(null); }}>
          <button type="button" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setViewing((viewing - 1 + CHARACTERS.length) % CHARACTERS.length); }} className="absolute left-6 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 text-ink hover:bg-white">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="fade-in flex max-h-full flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown.src} alt={shown.name} className="max-h-[calc(100vh-160px)] rounded-2xl object-contain shadow-[0_24px_64px_rgba(0,0,0,0.35)]" />
            <div className="flex items-center gap-3">
              <span className="text-[18px] font-extrabold text-white">{shown.name}</span>
              <button type="button" onClick={() => onPick(shown.id)} className="btn-primary px-5 py-2.5 text-[14px]">
                Use {shown.name}
              </button>
            </div>
          </div>
          <button type="button" aria-label="Next" onClick={(e) => { e.stopPropagation(); setViewing((viewing + 1) % CHARACTERS.length); }} className="absolute right-6 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 text-ink hover:bg-white">
            <ArrowLeft className="h-5 w-5 rotate-180" />
          </button>
          <button type="button" aria-label="Close" onClick={(e) => { e.stopPropagation(); setViewing(null); }} className="absolute right-6 top-6 rounded-full bg-white/90 p-2 text-ink hover:bg-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** The run's starting hook text (see store.createRun); replaced by the stolen hook's text on generate. */
const DEFAULT_HOOK_TEXT = "How is this tool even legal?";

/**
 * A sticky magnet for timeline drags: an edge snaps to the nearest point within `tol`, and once it has snapped
 * it holds there until pulled clearly away (2.2 x tol), so it "stops for a while" like a real magnet.
 */
function magnet(points: number[], tol: number) {
  let stuck: number | null = null;
  return (v: number): number | null => {
    if (stuck !== null && Math.abs(v - stuck) <= tol * 2.2) return stuck;
    stuck = points.reduce<number | null>((best, q) => (Math.abs(q - v) <= tol && (best === null || Math.abs(q - v) < Math.abs(best - v)) ? q : best), null);
    return stuck;
  };
}

/** The subtitle that starts last at or before time `at` (the one a new subtitle copies its look from); else the first. */
function lookBefore(texts: TextLayer[], at: number): TextLayer | undefined {
  const before = texts.filter((x) => x.start <= at + 0.01).sort((a, b) => b.start - a.start);
  return before[0] ?? texts[0];
}

/** The outlined button next to a step's main button (the other ways to do the step); violet when its panel is open. */
const optionBtn = (on: boolean) =>
  `flex items-center gap-1.5 rounded-lg border px-3.5 py-2.5 text-[14px] font-semibold ${on ? "border-accent bg-accent-tint text-accent" : "border-line-strong bg-panel text-text hover:border-accent hover:text-accent"}`;

/** Step 3: the hook clip, in the shared clip editor. Before generating, the video box shows the inputs and a Generate button.
 * Generation is a stand-in (a sample clip) until the Runway API is connected. */
function GenerateStep({ run, source, seg, texts, onGenerated, onPatch, onAdd, onRemove, onParts, onAdjust, onApplyAll }: {
  run: Run;
  source: Reference | null;
  seg: Seg;
  texts: TextLayer[];
  onGenerated: (g: NonNullable<Run["hook"]["generated"]>, text: string) => void;
  onPatch: (id: string, patch: Partial<TextLayer>) => void;
  onAdd: (afterId: string | null, window: [number, number]) => void;
  onRemove: (id: string) => void;
  onParts: (parts: Part[]) => void;
  onAdjust: (a: Partial<Adjust>) => void;
  onApplyAll?: (id: string) => void;
}) {
  const hook = run.hook;
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const described = hook.source === "describe" && hook.describeReady ? hook.describe : null;
  const face = hook.face ?? null;
  const ch = face?.kind === "character" ? characterById(face.id) : null;
  const ready = (Boolean(source) || Boolean(described)) && Boolean(face);

  // Regenerate: optional note on what went wrong, passed to the next generation.
  const [regen, setRegen] = useState(false);
  const [fix, setFix] = useState("");

  async function generate(note?: string) {
    setRegen(false);
    setFix("");
    setBusy(true);
    setStartedAt(Date.now());
    // TODO(Runway): send the reference video + character photo (+ `note` as extra prompt); this stand-in waits, then uses a sample clip.
    await new Promise((r) => setTimeout(r, STANDIN_SECONDS * 1000));
    const original = source?.recipe?.onScreenText?.[0]?.text ?? source?.title ?? "";
    onGenerated({ src: "/samples/hook-sample.mp4", seconds: 4.2, at: new Date().toISOString(), ...(note?.trim() ? { note: note.trim().slice(0, 300) } : {}) }, described ? "" : original);
    setBusy(false);
  }

  const mini = "h-[42px] w-[26px] rounded-[5px] border-2 border-white bg-ink object-cover object-top shadow-sm";
  const facePhoto = ch ? ch.src : face?.kind === "photo" ? `/api/media/${face.mediaId}` : null;
  const who = ch ? ch.name : "your character";
  const cover = busy ? (
    <GenerateProgress photo={facePhoto} who={who} startedAt={startedAt} estimate={STANDIN_SECONDS} />
  ) : !hook.generated ? (
    <div className="absolute inset-0 flex items-center justify-center">
      {facePhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={facePhoto} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover object-top opacity-60 blur-md" />
      )}
      {facePhoto && <span className="absolute inset-0 bg-ink/35" />}
      <button type="button" disabled={!ready} title={ready ? undefined : "Pick a hook and a character first"} onClick={() => void generate()} className="btn-primary relative px-4 py-2.5 text-[14px] disabled:opacity-50">
        Generate hook
      </button>
    </div>
  ) : null;

  return (
    <ClipEditor
      seg={seg}
      version={hook.generated?.at}
      texts={texts}
      cover={cover}
      onParts={onParts}
      onAdjust={onAdjust}
      onPatch={onPatch}
      onAdd={onAdd}
      onRemove={onRemove}
      onApplyAll={onApplyAll}
      firstTextPlaceholder="Hook text"
      overlay={
        <>
          {/* What goes in: the hook (step 1) and the character (step 2). */}
          <div className="absolute left-2 top-2 flex gap-1">
            {source ? <Thumb r={source} className={mini} /> : described ? <span className={`${mini} flex items-center justify-center bg-accent-tint text-[13px] font-black text-accent`}>&ldquo;</span> : null}
            {ch ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ch.thumb} alt="" className={mini} />
            ) : face?.kind === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/media/${face.mediaId}`} alt="" className={mini} />
            ) : null}
          </div>
          {hook.generated && !busy && (
            <button type="button" onClick={() => setRegen((o) => !o)} aria-expanded={regen} className="absolute right-2 top-2 flex items-center gap-1 rounded-lg bg-black/60 px-2 py-1 text-[12px] font-bold text-white hover:bg-black/75">
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate
            </button>
          )}
          {regen && hook.generated && !busy && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void generate(fix);
              }}
              onKeyDown={(e) => e.key === "Escape" && setRegen(false)}
              className="fade-in absolute inset-x-2 top-11 z-30 rounded-xl border border-line bg-panel p-2 shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
            >
              <textarea
                autoFocus
                value={fix}
                maxLength={300}
                rows={3}
                onChange={(e) => setFix(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void generate(fix);
                  }
                }}
                placeholder="What went wrong? (optional)"
                className="w-full resize-none rounded-lg border-[1.5px] border-line-strong bg-panel px-2.5 py-2 text-[13px] outline-none placeholder:text-soft focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button type="button" onClick={() => setRegen(false)} className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-muted hover:bg-raised">
                  Cancel
                </button>
                <button type="submit" className="btn-primary px-3 py-1.5 text-[12.5px]">
                  Regenerate
                </button>
              </div>
            </form>
          )}
        </>
      }
    />
  );
}

/**
 * The one editor every clip uses (the hook and each demo clip): the video with its texts, a player bar
 * (play, trim + Cut + Undo, text bars, zoom keyframes), Advanced settings, the text rows, and full screen.
 * Times on the player are on-screen seconds from the clip's start; texts are stored on the whole timeline.
 */
function ClipEditor({ seg, version, texts, cover, overlay, firstTextPlaceholder = "Text", onParts, onAdjust, onPatch, onAdd, onRemove, onApplyAll }: {
  seg: Seg;
  /** Changes when the clip's file is replaced (reloads the video). */
  version?: string;
  texts: TextLayer[];
  /** Shown instead of the video (e.g. generating, or not generated yet). */
  cover?: React.ReactNode;
  /** Extra controls on top of the video box. */
  overlay?: React.ReactNode;
  firstTextPlaceholder?: string;
  /** The clip's pieces changed (Cut, trim or delete a piece, Undo). */
  onParts: (parts: Part[]) => void;
  onAdjust: (a: Partial<Adjust>) => void;
  onPatch: (id: string, patch: Partial<TextLayer>) => void;
  onAdd: (afterId: string | null, window: [number, number]) => void;
  onRemove: (id: string) => void;
  /** Give every subtitle in the video this one's look and position. */
  onApplyAll?: (id: string) => void;
}) {
  const live = Boolean(seg.src && seg.editable && !cover);
  const panned = useRef(false);
  const [full, setFull] = useState(false);
  const [fullT, setFullT] = useState(0);
  // Player times are relative to the clip's start (0 = first kept frame), in on-screen seconds.
  // A Cut clip plays its pieces back to back; the playhead's frame comes from fileAt().
  const speed = speedOf(seg.adjust);
  const len = seg.len;
  const offset = seg.offset;
  const spans = pieceSpans(seg);
  const [draft, setDraft] = useState<{ i: number; a: number; b: number } | null>(null); // a piece being trimmed, until the handle is let go
  const [pick, setPick] = useState<string | null>(null); // the selected piece
  const [undo, setUndo] = useState<Part[][]>([]); // earlier pieces, newest last
  const [prevSpeed, setPrevSpeed] = useState(speed);
  if (prevSpeed !== speed) {
    setPrevSpeed(speed);
    setDraft(null);
  }
  const picked = seg.parts.length === 1 ? seg.parts[0].id : seg.parts.some((x) => x.id === pick) ? pick : null;
  const segRef = useRef(seg);
  useEffect(() => {
    segRef.current = seg;
  });
  const piece = useRef(0); // the piece playing
  const vref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  usePlaybackClaims(`clip:${seg.id}`, setPlaying);
  useEffect(() => {
    const video = vref.current;
    if (video) video.volume = fullAdjust(seg.adjust).volume / 100;
  }, [seg.adjust, version]);
  useEffect(() => {
    const video = vref.current;
    if (!video || !playing) return;
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) setPlaying(false); });
    observer.observe(video);
    const hide = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", hide);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", hide); };
  }, [playing]);
  const [t, setT] = useState(0);
  const seek = useCallback((rel: number) => {
    const { file, i } = fileAt(segRef.current, rel);
    piece.current = i;
    const v = vref.current;
    if (v) v.currentTime = file;
    setT(rel);
  }, []);
  /** Show piece i's first frame (after the pieces changed). */
  const jumpTo = (parts: Part[], i: number, at: number) => {
    piece.current = i;
    if (vref.current && parts[i]) vref.current.currentTime = parts[i].start;
    setT(at);
  };
  // Play the pieces back to back (skipping what was cut away), loop, and move the playhead smoothly.
  useEffect(() => {
    const v = vref.current;
    if (!v || !playing || !live) return;
    v.playbackRate = speed;
    void v.play().catch(() => undefined);
    let raf = 0;
    const frame = () => {
      const s = segRef.current;
      let i = Math.min(piece.current, s.parts.length - 1);
      const p = s.parts[i];
      if (v.ended || v.currentTime >= p.end - 0.02) {
        i = (i + 1) % s.parts.length;
        v.currentTime = s.parts[i].start;
        void v.play().catch(() => undefined);
      } else if (v.currentTime < p.start - 0.05) v.currentTime = p.start;
      piece.current = i;
      setT(Math.max(0, Math.min(s.len, pieceSpans(s)[i].at + (v.currentTime - s.parts[i].start) / speed)));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); v.pause(); };
  }, [playing, live, speed, version]);
  useEffect(() => {
    if (!playing) vref.current?.pause();
  }, [playing]);
  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [full]);

  // Zoom / position keyframes live in file time; the playhead's file time is fileT.
  const here = fileAt(seg, t);
  const fileT = here.file;
  const herePart = seg.parts[here.i];
  const canCut = (fileT - herePart.start) / speed > 0.2 && (herePart.end - fileT) / speed > 0.2;
  const change = (next: Part[]) => {
    setUndo((u) => [...u, seg.parts]);
    onParts(next);
  };
  const removePiece = () => {
    if (seg.parts.length < 2 || !picked) return;
    setPlaying(false);
    const next = seg.parts.filter((x) => x.id !== picked);
    change(next);
    setPick(null);
    jumpTo(next, 0, 0);
  };
  const look = videoStyle(seg.adjust, fileT);
  const motion = motionAt(seg.adjust, fileT);
  const zoomed = motion.zoom > 0;
  const allKeys = fullAdjust(seg.adjust).keys.slice().sort((x, y) => x.t - y.t);
  function panStart(e: React.PointerEvent<HTMLDivElement>) {
    panned.current = false;
    if (!zoomed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const at = fileT;
    const from = motionAt(seg.adjust, at);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!panned.current && Math.hypot(dx, dy) < 4) return;
      if (!panned.current) setPlaying(false);
      panned.current = true;
      onAdjust(setMotion(seg.adjust, at, panBy(from.zoom, dx, dy, rect.width, rect.height, from)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // This clip's texts (anything overlapping its part of the timeline), in clip time.
  const mine = texts.filter((x) => x.end > offset + 0.05 && x.start < offset + len - 0.05);
  const local = mine.map((x) => ({ ...x, start: Math.max(0, x.start - offset), end: Math.min(len, x.end - offset) }));
  const span: [number, number] = [round1(offset), round1(offset + len)];

  return (
    <div className="@container space-y-3">
      <div className="grid grid-cols-1 items-start gap-4 @min-[600px]:grid-cols-[300px_minmax(0,1fr)]">
        <div className="w-full max-w-[300px] space-y-2">
          <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-line bg-raised [container-type:size]">
            {cover ??
              (live && seg.src ? (
                <div
                  role="button"
                  tabIndex={0}
                  onPointerDown={panStart}
                  onClick={() => {
                    if (!panned.current) setFull(true);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setFull(true); } }}
                  aria-label="Play full screen"
                  title={zoomed ? "Drag to move the picture" : undefined}
                  className={`absolute inset-0 overflow-hidden ${zoomed ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-zoom-in"}`}
                >
                  <WarmthFilter adjust={seg.adjust} />
                  <video ref={vref} key={`${seg.src}|${version ?? ""}`} src={seg.src} muted={!playing} playsInline onLoadedMetadata={() => seek(0)} className="absolute inset-0 h-full w-full object-cover" style={look} />
                  {local.filter((x) => x.text.trim() && t >= x.start - 0.05 && t <= x.end + 0.05).map((x) => <TextOverlay key={x.id} x={x} onMove={(pos) => onPatch(x.id, pos)} />)}
                </div>
              ) : null)}
            {overlay}
          </div>

          {live && (
            <ClipControls
              label={seg.label}
              playing={playing}
              onPlay={() => { if (!playing) claimPlayback(`clip:${seg.id}`); setPlaying((x) => !x); }}
              t={t}
              len={len}
              pieces={seg.parts.map((x, i) => ({ id: x.id, at: spans[i].at, len: spans[i].len }))}
              selected={picked}
              onSelect={setPick}
              draft={draft}
              onTrim={(i, v, edge) => {
                setDraft({ i, a: v[0], b: v[1] });
                setPlaying(false);
                seek(edge);
              }}
              onTrimEnd={(i, [a, b]) => {
                // Trimming applies as soon as the handle is let go (Undo brings it back); later pieces close the gap.
                setDraft(null);
                const p = seg.parts[i];
                const span = spans[i];
                if (a <= span.at + 0.01 && b >= span.at + span.len - 0.01) return;
                const r = (x: number) => Math.round(x * 1000) / 1000;
                const next = seg.parts.map((x, j) => (j === i ? { ...p, start: r(p.start + (a - span.at) * speed), end: r(p.start + (b - span.at) * speed) } : x));
                change(next);
                jumpTo(next, i, span.at);
              }}
              onDelete={seg.parts.length > 1 && picked ? removePiece : undefined}
              onSeek={(rel) => {
                setPlaying(false);
                seek(rel);
              }}
              canCut={canCut}
              onCut={() => {
                // Cut = two pieces side by side in this clip; nothing is removed or moved.
                setPlaying(false);
                const f = Math.round(fileT * 1000) / 1000;
                // The new piece (after the playhead) is selected, like CapCut; the others show lighter.
                const second = { id: uid(), start: f, end: herePart.end };
                change([...seg.parts.slice(0, here.i), { ...herePart, end: f }, second, ...seg.parts.slice(here.i + 1)]);
                setPick(second.id);
              }}
              texts={local}
              onTiming={(tid, patch) =>
                // No 0.1s rounding here: a snapped edge must land exactly on the clip's start / end.
                onPatch(tid, {
                  ...(patch.start !== undefined ? { start: Math.round((patch.start + offset) * 1000) / 1000 } : {}),
                  ...(patch.end !== undefined ? { end: Math.round((patch.end + offset) * 1000) / 1000 } : {}),
                })
              }
              keys={allKeys.flatMap((k, i) => {
                const at = relAt(seg, k.t);
                return at === null ? [] : [{ i, at }];
              })}
              onKeyMove={(i, rel) => onAdjust(moveKey(seg.adjust, i, fileAt(seg, Math.max(0, Math.min(len, rel))).file))}
              canUndo={undo.length > 0}
              onUndo={() => {
                const last = undo[undo.length - 1];
                if (!last) return;
                setUndo((u) => u.slice(0, -1));
                onParts(last);
                setDraft(null);
                setPick(null);
                setPlaying(false);
                jumpTo(last, 0, 0);
              }}
            />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <AdvancedSettings
            value={seg.adjust}
            disabled={!live}
            onChange={onAdjust}
            motion={motion}
            keyOn={keyAt(seg.adjust, fileT) >= 0}
            onMotion={(patch) => {
              setPlaying(false);
              onAdjust(setMotion(seg.adjust, fileT, patch));
            }}
            onKey={() => {
              setPlaying(false);
              onAdjust(toggleKey(seg.adjust, fileT));
            }}
          />
        </div>
      </div>

      {mine.length > 0 ? (
        <div className="space-y-2">
          {mine.map((x, i) => (
            <TextRow key={x.id} t={x} placeholder={i === 0 ? firstTextPlaceholder : "More text"} onPatch={(patch) => onPatch(x.id, patch)} onAdd={() => onAdd(x.id, span)} onRemove={() => onRemove(x.id)} onApplyAll={onApplyAll && texts.length > 1 ? () => onApplyAll(x.id) : undefined} />
          ))}
        </div>
      ) : (
        <button type="button" onClick={() => onAdd(null, span)} className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong py-3 text-[13.5px] font-semibold text-muted hover:border-accent hover:text-accent">
          <Plus className="h-4 w-4" />
          Add text
        </button>
      )}

      {full && live && seg.src && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-6" onClick={() => setFull(false)}>
          <div className="fade-in relative aspect-[9/16] h-[min(86vh,900px)] overflow-hidden rounded-2xl bg-black shadow-[0_24px_64px_rgba(0,0,0,0.35)] [container-type:size]" onClick={(e) => e.stopPropagation()}>
            <WarmthFilter adjust={seg.adjust} />
            <TrimmedVideo src={seg.src} parts={seg.parts} rate={speed} adjust={seg.adjust} onTime={setFullT} />
            {local.filter((x) => x.text.trim() && fullT >= x.start && fullT < x.end).map((x) => <TextOverlay key={x.id} x={x} onMove={(pos) => onPatch(x.id, pos)} />)}
          </div>
          <button type="button" aria-label="Close" onClick={() => setFull(false)} className="absolute right-6 top-6 rounded-full bg-white/90 p-2 text-ink hover:bg-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Step 5 player: the whole video (hook, then every demo clip) with its texts and sound line, on one clock. */
/** The full editor's extras on the whole-video timeline: clips and texts become selectable and editable, and it zooms. */
type TimelineEdit = {
  zoom: number;
  /** `${clip id}:${piece id}` */
  selClip: string | null;
  selText: string | null;
  onSelectClip: (segId: string, partId: string) => void;
  onSelectText: (id: string) => void;
  /** Piece i of a clip was trimmed to [a, b] (timeline seconds, inside its old window). */
  onClipTrim: (segId: string, i: number, a: number, b: number) => void;
  onTextTiming: (id: string, p: { start?: number; end?: number }) => void;
  /** A text drag (or a drag on the preview) starts: one undo step. */
  onTextBegin: () => void;
  onTextMove: (id: string, pos: Partial<TextLayer>) => void;
  /** A clip piece was dragged to just before clip `beforeId` (null = the end). */
  onMoveClip: (segId: string, partId: string, beforeId: string | null) => void;
  /** Main track magnet: on = clips stay joined; off = clips can be dragged anywhere, leaving empty space. */
  magnet: boolean;
  /** Magnet off: a clip was dragged to start at timeline time `to`. */
  onShiftClip: (segId: string, to: number) => void;
};

function WholePlayer({ segs, texts, pieces, selected, side, onSelect, onTrim, onMove, onSplit, onAdd, onDelete, onUndo, onRedo, onCopy, onPaste, claim = "whole", edit, toolbar, compact = false, autoFocus = false }: {
  segs: Seg[];
  /** Shown next to the video (the selected sound's card, or the editor's settings for the selection). */
  side: React.ReactNode | ((time: number) => React.ReactNode);
  /** Playback id (one player plays at a time). */
  claim?: string;
  /** Ctrl+C / Ctrl+V (the full editor). */
  onCopy?: () => void;
  onPaste?: (time: number) => void;
  edit?: TimelineEdit;
  /** Replaces the Cut / + Sound buttons (the full editor's tools); gets the playhead time. */
  toolbar?: (time: number) => React.ReactNode;
  compact?: boolean;
  autoFocus?: boolean;
  texts: TextLayer[];
  pieces: SoundPiece[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onTrim: (id: string, at: number, end: number) => void;
  onMove: (id: string, at: number, end: number) => void;
  onSplit: (t: number) => void;
  onAdd: (t: number) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const total = Math.max(0.5, videoLength(segs));
  const [t, setT] = useState(0);
  // Starts paused; pressing play here pauses the phone preview (one sound at a time).
  const [playing, setPlaying] = useState(false);
  usePlaybackClaims(claim, setPlaying);
  useEffect(() => {
    if (autoFocus) scope.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  // Editor: the height of the space above the timeline (the video fills it).
  const stage = useRef<HTMLDivElement>(null);
  const [stageH, setStageH] = useState(0);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStageH(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      setT((cur) => (cur + dt >= total ? 0 : cur + dt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);
  const time = Math.min(t, total - 0.001);
  const hit = segAt(segs, time);
  const seg = hit ?? segs[segs.length - 1];
  const speed = seg.editable ? speedOf(seg.adjust) : 1;
  const { file: at, i: piece } = fileAt(seg, time - seg.offset);

  // Keyboard, like CapCut: Space play/pause, Delete removes the selected sound, S / Ctrl+B split, Ctrl+Z undo, Ctrl+Shift+Z redo, arrows move the playhead, Esc deselects.
  const keys = useRef({ time, playing, onSplit, onDelete, onUndo, onRedo, onSelect, onCopy, onPaste });
  useEffect(() => {
    keys.current = { time, playing, onSplit, onDelete, onUndo, onRedo, onSelect, onCopy, onPaste };
  });
  // The last click was in this player: shortcuts keep working even when focus fell back to the page (e.g. after Delete).
  const active = useRef(Boolean(autoFocus));
  useEffect(() => {
    const down = (e: PointerEvent) => {
      active.current = Boolean(scope.current?.contains(e.target as Node));
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const root = scope.current;
      if (!el || !root) return;
      const inside = root.contains(el) || ((el === document.body || el === document.documentElement || root.closest('[role="dialog"]')?.contains(el)) && active.current);
      if (!inside) return;
      // Not while typing, and not under another open dialog (the full editor is one itself). On a button, Space / Enter press it.
      const own = root.closest('[role="dialog"]');
      const others = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].some((d) => d !== own && !d.contains(root));
      if (e.defaultPrevented || el.closest("input, textarea, select, [contenteditable]") || others) return;
      if ((e.code === "Space" || e.key === "Enter") && el.closest("button, a, label")) return;
      const k = keys.current;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === "Space") {
        if (!k.playing) claimPlayback(claim);
        setPlaying(!k.playing);
      } else if (e.key === "Delete" || e.key === "Backspace") k.onDelete();
      else if ((!mod && e.key.toLowerCase() === "s") || (mod && e.key.toLowerCase() === "b")) {
        setPlaying(false);
        k.onSplit(k.time);
      } else if (mod && e.key.toLowerCase() === "c" && k.onCopy) k.onCopy();
      else if (mod && e.key.toLowerCase() === "v" && k.onPaste) {
        setPlaying(false);
        k.onPaste(k.time);
      } else if (mod && e.key.toLowerCase() === "z") (e.shiftKey ? k.onRedo : k.onUndo)();
      else if (mod && e.key.toLowerCase() === "y") k.onRedo();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        setPlaying(false);
        const step = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowLeft" ? -1 : 1);
        setT(Math.max(0, Math.min(total - 0.01, k.time + step)));
      } else if (e.key === "Escape") k.onSelect(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [total, claim]);

  const focusIn = (e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).closest("input, textarea, select, button, a, [contenteditable]")) scope.current?.focus({ preventScroll: true });
  };
  const videoBox = (cls: string, style?: React.CSSProperties) => (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-[#14121f] [container-type:size] ${cls}`} style={style}>
      {!hit ? null : seg.src ? (
        <>
          <WarmthFilter adjust={seg.editable ? seg.adjust : null} />
          <SyncedVideo key={`${seg.id}|${seg.src}`} src={seg.src} at={at} piece={piece} playing={playing} rate={speed} volume={seg.editable ? fullAdjust(seg.adjust).volume / 100 : 0} style={seg.editable ? videoStyle(seg.adjust, at) : undefined} />
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold text-white/40">{seg.id === "hook" ? "Your hook" : "Your demo"}</div>
      )}
      {texts.filter((x) => x.text.trim() && time >= x.start && time < x.end).map((x) => <TextOverlay key={x.id} x={x} onMove={edit ? (pos) => edit.onTextMove(x.id, pos) : undefined} />)}
    </div>
  );
  const sideNode = typeof side === "function" ? side(time) : side;
  const audio = pieces.map((p, i) => <SyncedAudio key={p.id} src={p.src} at={soundAt({ ...p, end: pieceEnd(pieces, i, total) }, time)} playing={playing} volume={p.volume / 100} />);
  const controls = (
    <WholeControls
      segs={segs}
      texts={texts}
      pieces={pieces}
      selected={selected}
      total={total}
      t={time}
      playing={playing}
      edit={edit}
      toolbar={toolbar?.(time)}
      onPlay={() => {
        if (!playing) claimPlayback(claim);
        setPlaying((p) => !p);
      }}
      onSeek={(v) => {
        setPlaying(false);
        setT(Math.max(0, Math.min(total - 0.01, v)));
      }}
      onSelect={onSelect}
      onTrim={onTrim}
      onMove={onMove}
      onSplit={() => {
        setPlaying(false);
        onSplit(time);
      }}
      onAdd={() => {
        setPlaying(false);
        onAdd(time);
      }}
    />
  );

  if (compact) {
    // The full editor, like CapCut: the video in the middle, as tall as the space above the timeline; its settings right
    // beside it (scrolling on their own, so selecting something never moves the timeline); the timeline pinned below.
    return (
      <div ref={scope} tabIndex={-1} onPointerDownCapture={focusIn} className="flex h-full flex-col gap-3 outline-none focus-visible:outline-none">
        <div ref={stage} className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-5">
          <div />
          {videoBox("", { height: stageH, width: (stageH * 9) / 16 })}
          <div className="min-h-0 max-w-[380px] overflow-y-auto pr-1" style={{ maxHeight: stageH }}>
            {sideNode}
          </div>
        </div>
        {audio}
        <div className="max-h-[45vh] shrink-0 overflow-y-auto">{controls}</div>
      </div>
    );
  }
  return (
    <div ref={scope} tabIndex={-1} onPointerDownCapture={focusIn} className="@container space-y-4 outline-none focus-visible:outline-none">
      <div className="grid grid-cols-1 items-start gap-4 @min-[600px]:grid-cols-[300px_minmax(0,1fr)]">
        {videoBox("w-full max-w-[300px]")}
        <div className="min-w-0">{sideNode}</div>
      </div>
      {audio}
      {controls}
    </div>
  );
}

/** A row of frames from `src` at these file times, filling its parent (behind the label). */
function Filmstrip({ src, times, frame }: { src: string; times: number[]; frame: number }) {
  const key = times.join(",");
  const [frames, setFrames] = useState<{ key: string; urls: Record<string, string> }>({ key: "", urls: {} });
  const requestKey = `${src}|${key}`;
  const urls = frames.key === requestKey ? frames.urls : {};
  useEffect(() => {
    let alive = true;
    for (const t of key.split(",").map(Number)) {
      void frameAt(src, t).then((url) => {
        if (alive && url) setFrames((previous) => ({ key: requestKey, urls: { ...(previous.key === requestKey ? previous.urls : {}), [`${src}@${t}`]: url } }));
      });
    }
    return () => {
      alive = false;
    };
  }, [src, key, requestKey]);
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 flex overflow-hidden">
      {times.map((t, i) => {
        const url = urls[`${src}@${t}`];
        return <span key={i} className="h-full shrink-0 bg-cover bg-center" style={{ width: frame, backgroundImage: url ? `url(${url})` : undefined }} />;
      })}
    </span>
  );
}

/** Player bar for the whole video, three lines like CapCut: the clips, the texts, the sound line (click a sound, ✂ split it, drag its ends to trim, + add another). */
function WholeControls({ segs, texts, pieces, selected, total, t, playing, onPlay, onSeek, onSelect, onTrim, onMove, onSplit, onAdd, edit, toolbar }: {
  edit?: TimelineEdit;
  toolbar?: React.ReactNode;
  segs: Seg[];
  texts: TextLayer[];
  pieces: SoundPiece[];
  selected: string | null;
  total: number;
  t: number;
  playing: boolean;
  onPlay: () => void;
  onSeek: (t: number) => void;
  onSelect: (id: string | null) => void;
  onTrim: (id: string, at: number, end: number) => void;
  onMove: (id: string, at: number, end: number) => void;
  onSplit: () => void;
  onAdd: () => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  // Seconds across the bar. The editor leaves room after the video (like CapCut), so the end of the video is not the end of the bar.
  const width = edit ? Math.max(total * 2, total + 10) : total;
  const pct = (v: number) => `${(Math.max(0, Math.min(width, v)) / width) * 100}%`;
  // A sound being trimmed follows the pointer; it is saved once, on release.
  const [draft, setDraft] = useState<{ id: string; at: number; end: number } | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const span = (p: SoundPiece, i: number): [number, number] => (draft?.id === p.id ? [draft.at, draft.end] : [p.at, pieceEnd(pieces, i, total)]);
  const underPlayhead = pieces.some((p, i) => t > p.at + 0.25 && t < pieceEnd(pieces, i, total) - 0.25);
  // Editor: a clip piece being trimmed (timeline seconds), saved on release.
  // The trimmed piece keeps its start on the timeline and everything after it slides along (no gap, like CapCut's main track).
  const [clipDraft, setClipDraft] = useState<{ key: string; seg: string; lo: number; cutL: number; cutR: number } | null>(null);
  // Zoomed in: keep the playhead in view while playing.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing || el.scrollWidth <= el.clientWidth) return;
    const x = (t / width) * el.scrollWidth;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = x - 24;
  }, [t, playing, width]);

  // Editor: the bar's width in pixels (how many frames fit on each clip piece).
  const [areaW, setAreaW] = useState(0);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAreaW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Editor: a clip piece being dragged to a new place (pixels moved, and where it would land).
  const [clipMove, setClipMove] = useState<{ key: string; seg: string; whole: boolean; dx: number; at: number | null } | null>(null);
  /** Editor: press a clip piece to select it (and put the playhead there); drag it sideways to move it between the demo clips. The hook stays first. */
  function pressClip(e: React.PointerEvent, x: Seg, partId: string, key: string, lo: number, hi: number) {
    e.stopPropagation();
    const rect = area.current?.getBoundingClientRect();
    if (!rect || !edit) return;
    const drop = edit.onMoveClip;
    const shiftTo = edit.onShiftClip;
    edit.onSelectClip(x.id, partId);
    const toT = (cx: number) => ((cx - rect.left) / rect.width) * width;
    onSeek(toT(e.clientX));
    // Magnet off: the whole clip slides along the timeline, between its neighbours (the hook stays first).
    if (!edit.magnet) {
      const i = segs.findIndex((g) => g.id === x.id);
      const prevEnd = i > 0 ? segs[i - 1].offset + segs[i - 1].len : 0;
      const nx = segs[i + 1];
      const sx0 = e.clientX;
      let to = x.offset;
      let slid = false;
      const slide = (ev: PointerEvent) => {
        if (x.id === "hook") return onSeek(toT(ev.clientX));
        if (!slid && Math.abs(ev.clientX - sx0) < 4) return;
        slid = true;
        to = Math.max(prevEnd, Math.min(nx ? nx.offset - x.len : Infinity, x.offset + ((ev.clientX - sx0) / rect.width) * width));
        setClipMove({ key, seg: x.id, whole: true, dx: ((to - x.offset) / width) * rect.width, at: null });
      };
      const done = () => {
        window.removeEventListener("pointermove", slide);
        window.removeEventListener("pointerup", done);
        setClipMove(null);
        if (slid) shiftTo(x.id, Math.round(to * 1000) / 1000);
      };
      window.addEventListener("pointermove", slide);
      window.addEventListener("pointerup", done);
      return;
    }
    const movable = x.id !== "hook" || x.parts.length > 1;
    const bounds: { id: string | null; at: number }[] = [...segs.filter((g) => g.id !== "hook").map((g) => ({ id: g.id as string | null, at: g.offset })), { id: null, at: total }];
    const sx = e.clientX;
    let dragging = false;
    let target: string | null | undefined;
    const move = (ev: PointerEvent) => {
      if (!movable) {
        onSeek(toT(ev.clientX));
        return;
      }
      if (!dragging && Math.abs(ev.clientX - sx) < 4) return;
      dragging = true;
      const mid = (lo + hi) / 2 + ((ev.clientX - sx) / rect.width) * width;
      const near = bounds.reduce((best, c) => (Math.abs(c.at - mid) < Math.abs(best.at - mid) ? c : best));
      target = near.id;
      setClipMove({ key, seg: x.id, whole: false, dx: ev.clientX - sx, at: near.at });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setClipMove(null);
      if (dragging && target !== undefined) drop(x.id, partId, target);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Editor: drag one end of a clip piece inward (what is trimmed off can come back with Undo). */
  function trimClip(e: React.PointerEvent, segId: string, i: number, key: string, lo: number, hi: number, edge: "left" | "right") {
    e.preventDefault();
    e.stopPropagation();
    const rect = area.current?.getBoundingClientRect();
    if (!rect || !edit) return;
    const done = edit.onClipTrim;
    const sx = e.clientX;
    // The end snaps (12px) to the playhead, texts and sounds.
    const snapEnd = magnet([t, ...texts.flatMap((x) => [x.start, x.end]), ...pieces.flatMap((q, j) => [q.at, pieceEnd(pieces, j, total)])], (12 / rect.width) * width);
    let cut: [number, number] = [0, 0];
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - sx) / rect.width) * width;
      if (edge === "left") cut = [Math.max(0, Math.min(hi - lo - 0.3, dx)), 0];
      else {
        const raw = hi + dx;
        const snapped = snapEnd(raw);
        const end = Math.max(lo + 0.3, Math.min(hi, snapped ?? raw));
        setGuide(snapped !== null && end === snapped ? snapped : null);
        cut = [0, hi - end];
      }
      setClipDraft({ key, seg: segId, lo, cutL: cut[0], cutR: cut[1] });
      onSeek(edge === "left" ? lo + cut[0] : hi - cut[1] - 0.01);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuide(null);
      setClipDraft(null);
      if (cut[0] || cut[1]) done(segId, i, lo + cut[0], hi - cut[1]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  /** Editor: drag a text bar (move / either end), with a magnet to clip edges, the playhead and other texts. */
  function dragText(e: React.PointerEvent, x: TextLayer, mode: "move" | "left" | "right") {
    const rect = area.current?.getBoundingClientRect();
    if (!rect || !edit) return;
    edit.onSelectText(x.id);
    dragTextBar(e, rect, total, x, mode, [0, total, t, ...segs.map((g) => g.offset), ...texts.filter((o) => o.id !== x.id).flatMap((o) => [o.start, o.end])], edit.onTextTiming, setGuide, edit.onTextBegin, width);
  }

  function seek(e: React.PointerEvent) {
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    const at = (x: number) => ((x - rect.left) / rect.width) * width;
    onSeek(at(e.clientX));
    const move = (ev: PointerEvent) => onSeek(at(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Drag the body of sound i to move it (same length, its audio moves with it). Magnet to clip edges, the playhead and the neighbours; never overlaps them. */
  function moveSound(e: React.PointerEvent, i: number) {
    e.preventDefault();
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    const p = pieces[i];
    const [a0, b0] = [p.at, pieceEnd(pieces, i, total)];
    const size = b0 - a0;
    const [lo, hi] = rowBounds(pieces, i, total);
    const tol = (12 / rect.width) * width;
    const points = [0, total, t, lo, hi, ...segs.map((x) => x.offset), ...pieces.flatMap((q, j) => (j === i ? [] : [q.at, pieceEnd(pieces, j, total)]))];
    const snapA = magnet(points, tol);
    const snapB = magnet(points, tol);
    const sx = e.clientX;
    let moved = false;
    let next: [number, number] = [a0, b0];
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return;
      moved = true;
      const raw = a0 + ((ev.clientX - sx) / rect.width) * width;
      const sa = snapA(raw);
      const sb = snapB(raw + size);
      let a = sa !== null && (sb === null || Math.abs(sa - raw) <= Math.abs(sb - raw - size)) ? sa : sb !== null ? sb - size : raw;
      a = Math.max(lo, Math.min(hi - size, a));
      setGuide(sa !== null && a === sa ? sa : sb !== null && a === sb - size ? sb : null);
      next = [a, a + size];
      setDraft({ id: p.id, at: next[0], end: next[1] });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuide(null);
      setDraft(null);
      if (moved && next[0] !== a0) onMove(p.id, Math.round(next[0] * 1000) / 1000, Math.round(next[1] * 1000) / 1000);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Drag one end of sound i: never past its neighbours; snaps to clip edges and the playhead. */
  function trim(e: React.PointerEvent, i: number, edge: "left" | "right") {
    e.preventDefault();
    e.stopPropagation();
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    const p = pieces[i];
    const [a0, b0] = [p.at, pieceEnd(pieces, i, total)];
    const [lo, hi] = rowBounds(pieces, i, total);
    const tol = (12 / rect.width) * width;
    // Magnet: clip edges, the playhead, the start / end, and the neighbouring sounds' edges (so they connect).
    const points = [0, total, t, lo, hi, ...segs.map((x) => x.offset), ...pieces.flatMap((q, j) => (j === i ? [] : [q.at, pieceEnd(pieces, j, total)]))];
    const sx = e.clientX;
    let next: [number, number] = [a0, b0];
    const snapEdge = magnet(points, tol);
    const move = (ev: PointerEvent) => {
      const raw = (edge === "left" ? a0 : b0) + ((ev.clientX - sx) / rect.width) * width;
      const snapped = snapEdge(raw);
      const v = snapped ?? raw;
      next = edge === "left" ? [Math.max(lo, Math.min(b0 - 0.5, v)), b0] : [a0, Math.min(hi, Math.max(a0 + 0.5, v))];
      const moved = edge === "left" ? next[0] : next[1];
      setGuide(snapped !== null && moved === snapped ? snapped : null);
      setDraft({ id: p.id, at: next[0], end: next[1] });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuide(null);
      setDraft(null);
      if (next[0] !== a0 || next[1] !== b0) onTrim(p.id, Math.round(next[0] * 1000) / 1000, Math.round(next[1] * 1000) / 1000);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="w-full rounded-2xl border border-line bg-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={onPlay} title="Play / pause (Space)" className="btn-primary h-7 w-7 rounded-full p-0" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />}
        </button>
        <span className="whitespace-nowrap text-[12.5px] tabular-nums text-muted">
          {clock(t)} / {clock(total)}
        </span>
        <div className="ml-auto flex flex-wrap items-center justify-end">
          {toolbar ?? (
            <>
              <button type="button" disabled={!underPlayhead} onClick={onSplit} title="Cut the sound in two at the playhead (S)" className="flex items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[12px] font-bold text-text hover:bg-raised hover:text-accent disabled:text-soft disabled:hover:bg-transparent">
                <Scissors className="h-3.5 w-3.5" />
                Cut
              </button>
              <button type="button" onClick={onAdd} title="Add a sound at the playhead" className="flex items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[12px] font-bold text-text hover:bg-raised hover:text-accent">
                <Plus className="h-3.5 w-3.5" />
                Sound
              </button>
            </>
          )}
        </div>
      </div>
      <div ref={scroller} className={edit ? "overflow-x-auto pb-1" : undefined}>
      <div ref={area} className="relative select-none" style={edit ? { width: `${edit.zoom * 100}%` } : undefined}>
        <div className="relative h-4 cursor-pointer" onPointerDown={seek}>
          {Array.from({ length: Math.floor(width) + 1 }, (_, s) => (
            <span key={s} className="absolute top-0 h-1.5 w-px bg-line" style={{ left: pct(s) }} />
          ))}
        </div>
        {/* 1. the clips (editor: every piece, selectable, trim handles on the selected one) */}
        {edit ? (
          <div className="relative h-14 cursor-pointer rounded-md bg-raised/70" onPointerDown={seek}>
            {segs.flatMap((x, si) => {
              const spans = pieceSpans(x);
              const name = x.id === "hook" ? "Hook" : x.src ? x.label : "Demo";
              return x.parts.map((part, pi) => {
                const key = `${x.id}:${part.id}`;
                const lo = x.offset + spans[pi].at;
                const hi = lo + spans[pi].len;
                const d = clipDraft;
                // Magnet on: everything after slides along; off: only the rest of this clip does (the next clip stays, leaving space).
                const shift = d && lo > d.lo + 0.001 && (edit.magnet || x.id === d.seg) ? d.cutL + d.cutR : 0;
                const [a, b] = d?.key === key ? [lo, hi - d.cutL - d.cutR] : [lo - shift, hi - shift];
                const on = edit.selClip === key;
                const moving = Boolean(clipMove && (clipMove.whole ? clipMove.seg === x.id : clipMove.key === key));
                const handle = "absolute inset-y-0 z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-ink";
                // Frames across the piece, one every 32px, from the part of the file it plays (rounded to 0.5s so they are reused).
                const FRAME = 32;
                const pps = areaW / width;
                const speed = x.editable ? speedOf(x.adjust) : 1;
                const count = pps > 0 ? Math.min(80, Math.max(1, Math.ceil(((hi - lo) * pps) / FRAME))) : 0;
                const times = Array.from({ length: count }, (_, k) => Math.round(Math.min(part.end - 0.05, part.start + ((k * FRAME + FRAME / 2) / pps) * speed) * 2) / 2);
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={`Clip: ${name}${x.parts.length > 1 ? ` ${pi + 1}` : ""}`}
                    aria-pressed={on}
                    onPointerDown={(e) => pressClip(e, x, part.id, key, lo, hi)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); edit.onSelectClip(x.id, part.id); }
                    }}
                    title={x.id === "hook" && x.parts.length === 1 ? undefined : "Drag to move"}
                    className={`absolute inset-y-0 flex items-center gap-1 overflow-hidden px-3.5 text-[10.5px] font-bold outline-none ${x.id === "hook" && x.parts.length === 1 ? "" : "cursor-grab active:cursor-grabbing"} ${si || pi ? "border-l-2 border-panel" : "rounded-l-md"} ${x.id === "hook" ? "bg-[#221d33] text-white" : si % 2 ? "bg-[#dfdde9] text-text" : "bg-[#d2d0df] text-text"} ${on ? "z-10 ring-2 ring-inset ring-accent" : ""} ${moving ? "z-30 opacity-80 shadow-lg" : ""}`}
                    style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, transform: moving && clipMove ? `translateX(${clipMove.dx}px)` : undefined }}
                  >
                    {x.src && count > 0 && <Filmstrip src={x.src} times={times} frame={FRAME} />}
                    <span className={`relative flex min-w-0 items-center gap-1 ${x.src ? "self-start mt-1 rounded bg-black/60 px-1.5 py-0.5 text-white" : ""}`}>
                      <Film className="h-3 w-3 shrink-0" />
                      <span className="truncate">{name}{x.parts.length > 1 ? ` ${pi + 1}` : ""}</span>
                      {x.src && <span className="shrink-0 font-semibold tabular-nums text-white/75">{fmtTime(hi - lo)}</span>}
                    </span>
                    {on && x.editable && (
                      <>
                        <span aria-label="Trim clip start" onPointerDown={(e) => trimClip(e, x.id, pi, key, lo, hi, "left")} className={`${handle} left-0`}>
                          <span className="h-3.5 w-0.5 rounded-full bg-white" />
                        </span>
                        <span aria-label="Trim clip end" onPointerDown={(e) => trimClip(e, x.id, pi, key, lo, hi, "right")} className={`${handle} right-0`}>
                          <span className="h-3.5 w-0.5 rounded-full bg-white" />
                        </span>
                      </>
                    )}
                  </div>
                );
              });
            })}
            {/* where the dragged clip will land */}
            {clipMove && clipMove.at !== null && <span className="pointer-events-none absolute -bottom-1 -top-1 z-40 w-[3px] -translate-x-1/2 rounded-full bg-accent" style={{ left: pct(clipMove.at ?? 0) }} />}
          </div>
        ) : (
        <div className="flex h-7 cursor-pointer overflow-hidden rounded-md text-[10.5px] font-bold" onPointerDown={seek}>
          {segs.map((x, i) => (
            <div
              key={x.id}
              title={x.label}
              className={`flex min-w-0 items-center border-white px-1.5 ${i ? "border-l-2" : ""} ${x.id === "hook" ? "bg-[#221d33] text-white" : !x.src ? "bg-hover text-soft" : i % 2 ? "bg-[#dfdde9] text-text" : "bg-[#d2d0df] text-text"}`}
              style={{ width: pct(x.len) }}
            >
              <span className="truncate">{x.id === "hook" ? "Hook" : x.src ? x.label : "Demo"}</span>
            </div>
          ))}
        </div>
        )}
        {/* 2. the texts (editor: drag to move, drag the ends to stretch) */}
        {texts.length > 0 && (
          <div className="mt-1 space-y-1">
            {texts.map((x) => (
              <div key={x.id} className={`relative cursor-pointer rounded-md bg-raised/70 ${edit ? "h-6" : "h-5"}`} onPointerDown={seek}>
                {edit ? (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Text: ${x.text.trim() || "Text"}`}
                    aria-pressed={edit.selText === x.id}
                    onPointerDown={(e) => dragText(e, x, "move")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); edit.onSelectText(x.id); }
                    }}
                    title="Drag to move. Drag the ends to make it longer or shorter."
                    className={`absolute inset-y-0 flex cursor-grab touch-none items-center gap-1 overflow-hidden rounded-md bg-texttrack-tint px-3.5 text-[10.5px] font-semibold text-texttrack outline-none active:cursor-grabbing ${edit.selText === x.id ? "ring-2 ring-inset ring-texttrack" : ""}`}
                    style={{ left: pct(x.start), width: `calc(${pct(x.end)} - ${pct(x.start)})` }}
                  >
                    <Type className="h-3 w-3 shrink-0" />
                    <span className="truncate">{x.text.trim() || "Text"}</span>
                    <span aria-label="Text start" onPointerDown={(e) => dragText(e, x, "left")} className="absolute inset-y-0 left-0 flex w-2.5 cursor-ew-resize touch-none items-center justify-center rounded-l-md bg-texttrack">
                      <span className="h-2.5 w-px rounded-full bg-white" />
                    </span>
                    <span aria-label="Text end" onPointerDown={(e) => dragText(e, x, "right")} className="absolute inset-y-0 right-0 flex w-2.5 cursor-ew-resize touch-none items-center justify-center rounded-r-md bg-texttrack">
                      <span className="h-2.5 w-px rounded-full bg-white" />
                    </span>
                  </div>
                ) : (
                  <div className="absolute inset-y-0 flex items-center gap-1 overflow-hidden rounded-md bg-texttrack-tint px-1.5 text-[10px] font-semibold text-texttrack" style={{ left: pct(x.start), width: `calc(${pct(x.end)} - ${pct(x.start)})` }}>
                    <Type className="h-3 w-3 shrink-0" />
                    <span className="truncate">{x.text}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {/* 3. the sounds: one row each (like the texts); pieces cut with Split stay on their row */}
        {pieces.length === 0 && (
          <div className="relative mt-1 flex h-9 items-center rounded-md bg-raised/70 px-2 text-[10.5px] font-semibold text-soft" onPointerDown={seek}>
            No sound yet
          </div>
        )}
        {soundRows(pieces).map((row) => (
        <div
          key={row}
          className="relative mt-1 h-9 cursor-pointer rounded-md bg-raised/70"
          onPointerDown={(e) => {
            onSelect(null);
            seek(e);
          }}
        >
          {pieces.map((p, i) => {
            if (rowOf(p) !== row) return null;
            const [a, b] = span(p, i);
            const on = p.id === selected;
            // Touching the sound before / after on this row: square corners there, so the two read as one connected strip.
            const joinL = pieces.some((q, j) => j !== i && rowOf(q) === row && Math.abs(span(q, j)[1] - a) < 0.01);
            const joinR = pieces.some((q, j) => j !== i && rowOf(q) === row && Math.abs(span(q, j)[0] - b) < 0.01);
            const handle = "absolute inset-y-0 z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-ink";
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`Sound: ${p.name}`}
                aria-pressed={on}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelect(p.id); }
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault(); e.stopPropagation();
                    const [lo, hi] = rowBounds(pieces, i, total);
                    const next = Math.max(lo, Math.min(hi - (b - a), a + (e.key === "ArrowRight" ? 0.1 : -0.1)));
                    onMove(p.id, next, next + b - a);
                  }
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(p.id);
                  moveSound(e, i);
                }}
                className={`absolute inset-y-0 flex cursor-grab touch-none items-center gap-1.5 overflow-hidden rounded-md px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-[10.5px] font-bold active:cursor-grabbing ${joinL ? "rounded-l-none" : ""} ${joinR ? "rounded-r-none border-r border-white" : ""} ${on ? "bg-soundtrack text-white" : "bg-soundtrack-tint text-soundtrack hover:bg-[#f3cfe6]"}`}
                style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }}
              >
                <Music className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{p.name}</span>
                {on && (
                  <>
                    <span aria-label="Trim sound start" onPointerDown={(e) => trim(e, i, "left")} className={`${handle} left-0 ${joinL ? "" : "rounded-l-md"}`}>
                      <span className="h-3.5 w-0.5 rounded-full bg-white" />
                    </span>
                    <span aria-label="Trim sound end" onPointerDown={(e) => trim(e, i, "right")} className={`${handle} right-0 ${joinR ? "" : "rounded-r-md"}`}>
                      <span className="h-3.5 w-0.5 rounded-full bg-white" />
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
        ))}
        {/* where the video ends */}
        {edit && <div className="pointer-events-none absolute bottom-0 top-0 z-10 border-l border-dashed border-line-strong" style={{ left: pct(total) }} />}
        <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-0.5 rounded bg-text" style={{ left: pct(t) }} />
        {guide !== null && <div className="pointer-events-none absolute -bottom-1 -top-1 z-30 w-px -translate-x-1/2 bg-accent" style={{ left: pct(guide) }} />}
      </div>
      </div>
    </div>
  );
}

/**
 * Step 5: the sound line, like CapCut's audio track. The first sound covers the whole video.
 * ✂ Split cuts a sound at the playhead, + Add sound puts another one in at the playhead, 🗑 leaves that stretch
 * to the video's own sound. Each sound: the hook's own sound, a real song, or the user's file.
 */
function useSounds(run: Run, source: Reference | null, videoLen: number, onPieces: (pieces: SoundPiece[]) => void) {
  const pieces = soundPieces(run, videoLen);
  const [selId, setSelId] = useState<string | null>(null);
  const found = pieces.findIndex((p) => p.id === selId);
  const selIndex = found >= 0 ? found : 0;
  const sel = pieces[selIndex] ?? null;
  // The chooser: for a new sound at [at, end], or to change the selected one.
  const [adding, setAdding] = useState<{ at: number; end: number } | null>(null);
  const [changing, setChanging] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [songBusy, setSongBusy] = useState<number | null>(null);
  const hookSrc = source ? refSoundSrc(source) : null;
  const choosing = !pieces.length || Boolean(adding) || changing;

  // Undo / redo for the sound line (this session).
  const [undoStack, setUndoStack] = useState<SoundPiece[][]>([]);
  const [redoStack, setRedoStack] = useState<SoundPiece[][]>([]);
  const put = (list: SoundPiece[]) => {
    setUndoStack((u) => [...u.slice(-49), pieces]);
    setRedoStack([]);
    onPieces([...list].sort((a, b) => a.at - b.at));
  };
  const undo = () => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, pieces]);
    onPieces(prev);
  };
  const redo = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, pieces]);
    onPieces(next);
  };
  const deleteSelected = () => {
    if (!sel || choosing) return;
    put(pieces.filter((p) => p.id !== sel.id));
    setSelId(null);
  };

  async function takeSong(song: Song) {
    setSongBusy(song.id);
    setError(null);
    try {
      const res = await fetch(`/api/songs/${song.id}`, { method: "POST" });
      const data = (await res.json()) as { mediaId?: string; name?: string; error?: string };
      if (!res.ok || !data.mediaId) throw new Error(data.error ?? "Could not get this song");
      await pick("song", `/api/media/${data.mediaId}`, data.name ?? song.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get this song");
      setBrowsing(false);
    } finally {
      setSongBusy(null);
    }
  }

  async function pick(kind: SoundPiece["kind"], src: string, name: string, refId?: string) {
    setBusy(kind);
    setError(null);
    const length = await audioLength(src);
    setBusy(null);
    if (length === null) {
      setError("This video has no sound we can play.");
      return;
    }
    const sound = { kind, src, name, refId, start: 0, length: round1(length) };
    if (changing && sel) put(pieces.map((p) => (p.id === sel.id ? { ...p, ...sound } : p)));
    else {
      // A new sound on its own row: the first covers the whole video; "+ Sound" runs from the playhead to the end.
      const span = adding ?? { at: 0, end: videoLen };
      const row = pieces.length ? Math.max(...pieces.map(rowOf)) + 1 : 0;
      const piece: SoundPiece = { id: uid(), volume: 100, ...sound, at: span.at, end: span.end, row };
      put([...pieces, piece]);
      setSelId(piece.id);
    }
    setAdding(null);
    setChanging(false);
    setBrowsing(false);
  }

  async function upload(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("audio/") && !f.type.startsWith("video/")) {
      setError("Please choose an audio or video file.");
      return;
    }
    setBusy("upload");
    setError(null);
    try {
      const { mediaId } = await uploadFile(f, true);
      await pick("upload", `/api/media/${mediaId}`, f.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  /** ✂ at the playhead: the sound under it becomes two pieces that play on as one. */
  function split(t: number) {
    const under = (j: number) => t > pieces[j].at + 0.25 && t < pieceEnd(pieces, j, videoLen) - 0.25;
    const i = selIndex >= 0 && under(selIndex) ? selIndex : pieces.findIndex((_, j) => under(j));
    if (i < 0) return;
    const p = pieces[i];
    const at = Math.round(t * 1000) / 1000;
    const second: SoundPiece = { ...p, id: uid(), at, end: pieceEnd(pieces, i, videoLen), start: round1(p.start + (at - p.at)) };
    put([...pieces.filter((x) => x.id !== p.id), { ...p, end: at }, second]);
    setSelId(second.id);
  }

  /** + Sound at the playhead: a new row from there to the end of the video; the chooser opens. */
  function addAt(t: number) {
    const at = Math.round(Math.min(t, videoLen - 0.5) * 1000) / 1000;
    setAdding({ at, end: videoLen });
    setChanging(false);
    setSelId(null);
  }

  /** Trimming a sound's start keeps its audio in place (the cut just hides the beginning), like CapCut. */
  function trimPiece(id: string, at: number, end: number) {
    put(pieces.map((p) => (p.id === id ? { ...p, start: Math.max(0, round1(p.start + (at - p.at))), at, end } : p)));
  }

  // Three ways to pick a sound, stacked to fit the narrow column: the main one full width, the other two side by side.
  const secondary = `${optionBtn(false)} justify-center`;
  const chooser = (
    <div className="space-y-2.5 rounded-2xl border border-line bg-panel p-4">
      {(adding || changing) && (
        <div className="flex items-center justify-between">
          <span className="text-[13.5px] font-semibold text-muted">{adding ? `New sound from ${fmtTime(adding.at)} to ${fmtTime(adding.end)}` : `Change "${sel?.name ?? "sound"}"`}</span>
          <button
            type="button"
            onClick={() => {
              setAdding(null);
              setChanging(false);
            }}
            className="rounded-md px-2 py-1 text-[13px] font-semibold text-soft hover:bg-raised hover:text-text"
          >
            Cancel
          </button>
        </div>
      )}
      {hookSrc && (
        <button type="button" disabled={Boolean(busy)} onClick={() => source && void pick("hook", hookSrc, soundName(source), source.id)} className="btn-primary w-full px-4 py-2.5 text-[14px] disabled:opacity-60">
          {busy === "hook" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Use the hook's sound"}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" onClick={() => setBrowsing(true)} className={hookSrc ? secondary : `btn-primary px-3 py-2.5 text-[13.5px]`}>
          <Music className="h-4 w-4" />
          Browse songs
        </button>
        <label className={`${secondary} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy === "upload" ? "Uploading..." : "Upload your own"}
          <input type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => void upload(e.target.files?.[0]).then(() => (e.target.value = ""))} />
        </label>
      </div>
      {error && <p className="text-[13px] font-semibold text-red-600">{error}</p>}
    </div>
  );

  const span = sel ? pieceEnd(pieces, selIndex, videoLen) - sel.at : 0;
  const label = (k: SoundPiece["kind"]) => (k === "hook" ? "The hook's sound" : k === "song" ? "Song" : "Your sound");

  const panel = (
      <div className="min-w-0 space-y-3">
      {choosing ? (
      chooser
      ) : sel ? (
      <div className="rounded-2xl border border-line bg-panel">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soundtrack-tint text-soundtrack">
            <Music className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{sel.name}</div>
            <div className="truncate text-[13px] text-soft">
              {label(sel.kind)} · {fmtTime(sel.at)} to {fmtTime(sel.at + span)}
              {sel.length !== undefined && sel.length - sel.start < span - 0.05 && <span title="This stretch is longer than the sound, so the sound repeats"> · Loops</span>}
            </div>
          </div>
          <VolumeButton value={sel.volume} onChange={(volume) => put(pieces.map((p) => (p.id === sel.id ? { ...p, volume } : p)))} />
          <button
            type="button"
            onClick={deleteSelected}
            aria-label="Delete this sound"
            title="Delete this sound (Delete)"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-soft hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setChanging(true)} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
            Change
          </button>
        </div>
        <div className="border-t border-line px-4 pb-4 pt-3">
          <SoundPart key={sel.id} src={sel.src} length={sel.length ?? 0} start={sel.start} span={span} onChange={(start) => put(pieces.map((p) => (p.id === sel.id ? { ...p, start } : p)))} />
        </div>
      </div>
      ) : null}
      {browsing && <SongBrowser busyId={songBusy} onClose={() => setBrowsing(false)} onUse={(song) => void takeSong(song)} />}
    </div>
  );

  const select = (id: string | null) => {
    setSelId(id);
    setChanging(false);
    setAdding(null);
  };
  const move = (id: string, at: number, end: number) => put(pieces.map((p) => (p.id === id ? { ...p, at, end } : p)));
  return { pieces, sel, selId: found >= 0 ? selId : null, choosing, select, split, addAt, trimPiece, move, deleteSelected, undo, redo, panel };
}

/** Step 5: the whole video with its sound line. */
function SoundStep({ run, source, segs, texts, videoLen, onPieces }: {
  run: Run;
  source: Reference | null;
  segs: Seg[];
  texts: TextLayer[];
  videoLen: number;
  onPieces: (pieces: SoundPiece[]) => void;
}) {
  const s = useSounds(run, source, videoLen, onPieces);
  return (
    <WholePlayer
      segs={segs}
      texts={texts}
      pieces={s.pieces}
      selected={s.sel?.id ?? null}
      onSelect={s.select}
      onTrim={s.trimPiece}
      onMove={s.move}
      onSplit={s.split}
      onAdd={s.addAt}
      onDelete={s.deleteSelected}
      onUndo={s.undo}
      onRedo={s.redo}
      side={s.panel}
    />
  );
}

/** What Undo in the full editor brings back. */
type EditorSnap = { hook: Run["hook"]; demo: Run["demo"]; texts: TextLayer[]; sounds: SoundPiece[] };

/**
 * The full editor (Edit under the phone): every clip, text and sound on one timeline, like CapCut but only what
 * Mavya does. Select something to change it on the right; Cut (S), Delete and Undo work on the selection.
 */
function VideoEditor({ run, source, segs, texts, videoLen, onClose, onRestore, onParts, onDeleteClip, onAddVideos, onInsertClip, onMoveClip, onShiftClip, onCloseGaps, onAdjust, onPatchText, onAddText, onRemoveText, onApplyAll, onPieces }: {
  run: Run;
  source: Reference | null;
  segs: Seg[];
  texts: TextLayer[];
  videoLen: number;
  onClose: () => void;
  onRestore: (s: EditorSnap) => void;
  /** hold = keep the clips after it in place (magnet off). */
  onParts: (clipId: string, parts: Part[], hold?: boolean) => void;
  onDeleteClip: (clipId: string, hold?: boolean) => void;
  onShiftClip: (clipId: string, to: number) => void;
  onCloseGaps: () => void;
  /** Insert before demo clip `at`. */
  onAddVideos: (files: File[], at: number) => Promise<void>;
  onInsertClip: (clip: DemoClip, at: number) => void;
  onMoveClip: (segId: string, partId: string, beforeId: string | null) => void;
  onAdjust: (clipId: string, a: Partial<Adjust>) => void;
  onPatchText: (id: string, p: Partial<TextLayer>) => void;
  onAddText: (afterId: string | null, w: [number, number], text?: string, template?: TextLayer) => void;
  onRemoveText: (id: string) => void;
  onApplyAll: (id: string) => void;
  onPieces: (pieces: SoundPiece[]) => void;
}) {
  const [sel, setSel] = useState<{ kind: "clip"; seg: string; part: string } | { kind: "text"; id: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  // Main track magnet (on by default, like CapCut): clips stay joined. Off: drag clips anywhere, shortening leaves space.
  const [magnet, setMagnet] = useState(() => !segs.some((s) => s.gap > 0));
  const [past, setPast] = useState<EditorSnap[]>([]);
  const [future, setFuture] = useState<EditorSnap[]>([]);
  const [uploading, setUploading] = useState(false);
  // Copied with Ctrl+C (or Copy): a text, or a clip piece (pasted as a new clip).
  const [copied, setCopied] = useState<{ kind: "text"; t: TextLayer } | { kind: "clip"; clip: Omit<DemoClip, "id"> } | null>(null);
  const snap = (): EditorSnap => ({ hook: run.hook, demo: run.demo, texts, sounds: soundPieces(run, videoLen) });
  const remember = () => {
    setPast((p) => [...p.slice(-49), snap()]);
    setFuture([]);
  };
  // One snapshot for a continuous pointer gesture; keyboard changes start a new action.
  const gestureRemembered = useRef(false);
  const rememberGesture = () => {
    if (gestureRemembered.current) return;
    gestureRemembered.current = true;
    remember();
  };
  const sounds = useSounds(run, source, videoLen, (p) => {
    rememberGesture();
    onPieces(p);
  });
  const undo = () => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, snap()]);
    onRestore(last);
    setSel(null);
  };
  const redo = () => {
    const next = future[future.length - 1];
    if (!next) return;
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, snap()]);
    onRestore(next);
    setSel(null);
  };
  const pick = (next: typeof sel) => {
    setSel(next);
    sounds.select(null);
  };
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const selSeg = sel?.kind === "clip" ? segs.find((x) => x.id === sel.seg) : undefined;
  const selText = sel?.kind === "text" ? texts.find((x) => x.id === sel.id) : undefined;
  const canDelete = Boolean(selText || (selSeg && (selSeg.parts.length > 1 || selSeg.id !== "hook")) || (!sel && sounds.selId));

  /** ✂ at the playhead: the selected sound or text, else the clip under the playhead (two pieces, side by side). */
  const cut = (time: number) => {
    if (!sel && sounds.selId) {
      sounds.split(time);
      return;
    }
    if (selText) {
      if (time <= selText.start + 0.3 || time >= selText.end - 0.3) return;
      remember();
      onPatchText(selText.id, { end: r3(time) });
      onAddText(selText.id, [r3(time), selText.end], selText.text);
      return;
    }
    const seg = segs.find((x) => time >= x.offset && time < x.offset + x.len);
    if (!seg || !seg.editable) return;
    const { file, i } = fileAt(seg, time - seg.offset);
    const p = seg.parts[i];
    const sp = speedOf(seg.adjust);
    if ((file - p.start) / sp <= 0.2 || (p.end - file) / sp <= 0.2) return;
    const second = { id: uid(), start: r3(file), end: p.end };
    remember();
    onParts(seg.id, [...seg.parts.slice(0, i), { ...p, end: r3(file) }, second, ...seg.parts.slice(i + 1)]);
    pick({ kind: "clip", seg: seg.id, part: second.id });
  };
  /** Where a clip goes in at the playhead: the clip edge nearest to it (before the clip in its first half, else after). */
  const insertIndex = (time: number) => {
    const clips = demoClips(run);
    const seg = segs.find((x) => time >= x.offset && time < x.offset + x.len);
    const i = seg ? clips.findIndex((c) => c.id === seg.id) : -1;
    if (!seg) {
      const next = clips.findIndex((c) => (segs.find((s) => s.id === c.id)?.offset ?? Infinity) >= time);
      return next < 0 ? clips.length : next;
    }
    return seg.id === "hook" ? 0 : i < 0 ? clips.length : time - seg.offset > seg.len / 2 ? i + 1 : i;
  };
  const copy = () => {
    if (selText) setCopied({ kind: "text", t: selText });
    else if (selSeg && sel?.kind === "clip" && selSeg.src && selSeg.editable) {
      const part = selSeg.parts.find((x) => x.id === sel.part) ?? selSeg.parts[0];
      const from = demoClips(run).find((c) => c.id === selSeg.id);
      const name = selSeg.id === "hook" ? "Hook" : (from?.label ?? "Clip");
      setCopied({ kind: "clip", clip: { label: `${name} copy`, ...(from?.mediaId ? { mediaId: from.mediaId } : { src: selSeg.src }), name: from?.name ?? name, seconds: selSeg.seconds, start: part.start, end: part.end, adjust: selSeg.adjust } });
    }
  };
  /** Paste at the playhead: a text keeps its look and length; a clip goes in at the nearest clip edge. */
  const paste = (time: number) => {
    if (!copied) return;
    remember();
    if (copied.kind === "text") {
      const len = copied.t.end - copied.t.start;
      const at = r3(Math.max(0, Math.min(time, videoLen - 0.3)));
      onAddText(texts.some((x) => x.id === copied.t.id) ? copied.t.id : null, [at, r3(Math.min(videoLen, at + len))], copied.t.text, copied.t);
    } else onInsertClip({ ...copied.clip, id: uid() }, insertIndex(time));
  };
  const canCopy = Boolean(selText || (selSeg?.src && selSeg.editable));

  /** Delete the selection: a text, a clip piece (the last piece of a demo clip removes the clip), or a sound. */
  const remove = () => {
    if (selText) {
      remember();
      onRemoveText(selText.id);
      setSel(null);
    } else if (selSeg && sel?.kind === "clip") {
      if (selSeg.parts.length > 1) {
        remember();
        onParts(selSeg.id, selSeg.parts.filter((x) => x.id !== sel.part), !magnet);
      } else if (selSeg.id !== "hook") {
        remember();
        onDeleteClip(selSeg.id, !magnet);
      }
      setSel(null);
    } else if (sounds.selId) sounds.deleteSelected();
  };

  const side = (time: number) => {
    if (selSeg) {
      const fileT = fileAt(selSeg, Math.max(0, Math.min(selSeg.len, time - selSeg.offset))).file;
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <Film className="h-4 w-4 text-soft" />
            {selSeg.id === "hook" ? "Hook" : selSeg.label}
          </div>
          <AdvancedSettings
            key={selSeg.id}
            defaultOpen
            value={selSeg.adjust}
            disabled={!selSeg.editable || !selSeg.src}
            onChange={(a) => { rememberGesture(); onAdjust(selSeg.id, a); }}
            motion={motionAt(selSeg.adjust, fileT)}
            keyOn={keyAt(selSeg.adjust, fileT) >= 0}
            onMotion={(patch) => { rememberGesture(); onAdjust(selSeg.id, setMotion(selSeg.adjust, fileT, patch)); }}
            onKey={() => { rememberGesture(); onAdjust(selSeg.id, toggleKey(selSeg.adjust, fileT)); }}
          />
        </div>
      );
    }
    if (selText) {
      return (
        <TextRow
          key={selText.id}
          t={selText}
          placeholder="Text"
          onPatch={(patch) => { rememberGesture(); onPatchText(selText.id, patch); }}
          onAdd={() => {
            remember();
            onAddText(selText.id, [selText.start, selText.end]);
          }}
          onRemove={remove}
          onApplyAll={texts.length > 1 ? () => { remember(); onApplyAll(selText.id); } : undefined}
        />
      );
    }
    if (sounds.selId || sounds.choosing) return sounds.panel;
    return <p className="pt-1 text-[13px] text-soft">Select a clip, text or sound</p>;
  };

  const tool = "flex items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[12px] font-bold text-text hover:bg-raised hover:text-accent disabled:text-soft disabled:hover:bg-transparent";
  const toolbar = (time: number) => (
    <>
      <button type="button" disabled={!past.length} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo" className={tool}>
        <Undo2 className="h-4 w-4" />
      </button>
      <button type="button" disabled={!future.length} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" className={tool}>
        <Redo2 className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <button type="button" onClick={() => cut(time)} title="Cut at the playhead (S)" className={tool}>
        <Scissors className="h-3.5 w-3.5" />
        Cut
      </button>
      <button type="button" disabled={!canDelete} onClick={remove} title="Delete the selection (Delete)" className={tool}>
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
      <button type="button" disabled={!canCopy} onClick={copy} title="Copy the selected clip or text (Ctrl+C)" aria-label="Copy" className={tool}>
        <Copy className="h-4 w-4" />
      </button>
      <button type="button" disabled={!copied} onClick={() => paste(time)} title="Paste at the playhead (Ctrl+V)" aria-label="Paste" className={tool}>
        <ClipboardPaste className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <label title="Add video clips at the playhead (between clips)" className={`${tool} cursor-pointer ${uploading ? "pointer-events-none text-soft" : ""}`}>
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
        Clips
        <input
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (!files.length) return;
            const at = insertIndex(time);
            setUploading(true);
            remember();
            try {
              await onAddVideos(files, at);
            } finally {
              setUploading(false);
            }
          }}
        />
      </label>
      <button
        type="button"
        title="Add a text at the playhead"
        onClick={() => {
          const at = r3(Math.max(0, Math.min(time, videoLen - 0.5)));
          remember();
          onAddText(null, [at, r3(Math.min(videoLen, at + 2))]);
        }}
        className={tool}
      >
        <Type className="h-3.5 w-3.5" />
        Text
      </button>
      <button
        type="button"
        title="Add a sound at the playhead"
        onClick={() => {
          setSel(null);
          sounds.addAt(time);
        }}
        className={tool}
      >
        <Music className="h-3.5 w-3.5" />
        Sound
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <button
        type="button"
        aria-pressed={magnet}
        aria-label="Magnet"
        title={magnet ? "Magnet on: clips stay joined. Turn off to move clips freely and leave empty space." : "Magnet off: drag clips anywhere. Turn on to close the empty spaces."}
        onClick={() => {
          if (!magnet && segs.some((x) => x.gap > 0)) {
            remember();
            onCloseGaps();
          }
          setMagnet((m) => !m);
        }}
        className={`${tool} ${magnet ? "bg-accent-tint text-accent hover:bg-accent-tint" : ""}`}
      >
        <Magnet className="h-4 w-4" />
      </button>
      <button type="button" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 2))} title="Zoom out" aria-label="Zoom out" className={tool}>
        <ZoomOut className="h-4 w-4" />
      </button>
      <button type="button" disabled={zoom >= 8} onClick={() => setZoom((z) => Math.min(8, z * 2))} title="Zoom in" aria-label="Zoom in" className={tool}>
        <ZoomIn className="h-4 w-4" />
      </button>
    </>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit video" onPointerDownCapture={() => { gestureRemembered.current = false; }} onKeyDownCapture={(e) => { if (!e.repeat) gestureRemembered.current = false; }} className="fixed inset-0 z-40 flex flex-col bg-panel">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <h2 className="text-[16px] font-extrabold tracking-tight">Edit video</h2>
        <button type="button" onClick={onClose} className="btn-primary ml-auto px-4 py-2 text-[14px]">
          <Check className="h-4 w-4" />
          Done
        </button>
      </header>
      <div className="min-h-0 flex-1 px-5 py-4">
        <div className="mx-auto h-full max-w-[1400px]">
          <WholePlayer
            claim="editor"
            compact
            autoFocus
            segs={segs}
            texts={texts}
            pieces={sounds.pieces}
            selected={sel ? null : sounds.selId}
            onSelect={(id) => {
              setSel(null);
              sounds.select(id);
            }}
            onTrim={sounds.trimPiece}
            onMove={sounds.move}
            onSplit={cut}
            onAdd={sounds.addAt}
            onDelete={remove}
            onUndo={undo}
            onRedo={redo}
            onCopy={copy}
            onPaste={paste}
            side={side}
            toolbar={toolbar}
            edit={{
              zoom,
              selClip: sel?.kind === "clip" ? `${sel.seg}:${sel.part}` : null,
              selText: sel?.kind === "text" ? sel.id : null,
              onSelectClip: (seg, part) => pick({ kind: "clip", seg, part }),
              onSelectText: (id) => pick({ kind: "text", id }),
              onClipTrim: (segId, i, a, b) => {
                const seg = segs.find((x) => x.id === segId);
                if (!seg) return;
                const lo = seg.offset + pieceSpans(seg)[i].at;
                const sp = speedOf(seg.adjust);
                const p = seg.parts[i];
                remember();
                onParts(segId, seg.parts.map((x, j) => (j === i ? { ...p, start: r3(p.start + (a - lo) * sp), end: r3(p.start + (b - lo) * sp) } : x)), !magnet);
              },
              onTextTiming: (id, patch) => onPatchText(id, { ...(patch.start !== undefined ? { start: r3(patch.start) } : {}), ...(patch.end !== undefined ? { end: r3(patch.end) } : {}) }),
              onTextBegin: remember,
              onTextMove: (id, pos) => { rememberGesture(); onPatchText(id, pos); },
              magnet,
              onShiftClip: (segId, to) => {
                remember();
                onShiftClip(segId, to);
              },
              onMoveClip: (segId, partId, beforeId) => {
                remember();
                onMoveClip(segId, partId, beforeId);
                setSel(null);
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The whole sound as a waveform. The part as long as the video is colored (that is what plays); the rest is lighter.
 * Drag anywhere on it to slide which part plays.
 */
function SoundPart({ src, length, start, span, onChange }: { src: string; length: number; start: number; span: number; onChange: (start: number) => void }) {
  const BARS = 90;
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Read the sound once and boil it down to BARS loudness values for the waveform.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const values = await waveform(src, BARS);
        if (alive) setPeaks(values);
      } catch {
        if (alive) setPeaks(Array.from({ length: BARS }, (_, i) => 0.35 + 0.3 * Math.abs(Math.sin(i * 0.7))));
      }
    })();
    return () => {
      alive = false;
    };
  }, [src]);

  const total = Math.max(length, 0.1);
  const win = Math.min(span, total);
  const from = draft ?? Math.min(start, Math.max(0, total - win));
  const movable = total > win + 0.3;
  function drag(e: React.PointerEvent<HTMLDivElement>) {
    if (!movable) return;
    e.preventDefault();
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX;
    const s0 = from;
    let next = s0;
    const move = (ev: PointerEvent) => {
      next = Math.round(Math.max(0, Math.min(total - win, s0 + ((ev.clientX - sx) / rect.width) * total)) * 10) / 10;
      setDraft(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraft(null);
      if (next !== s0) onChange(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const inWin = (i: number) => {
    const t = ((i + 0.5) / BARS) * total;
    return t >= from && t <= from + win;
  };
  return (
    <div>
      <div
        ref={box}
        role="slider"
        tabIndex={movable ? 0 : -1}
        aria-label="Song part"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, total - win)}
        aria-valuenow={from}
        onKeyDown={(e) => {
          if (!movable || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          onChange(e.key === "Home" ? 0 : e.key === "End" ? total - win : Math.max(0, Math.min(total - win, from + (e.key === "ArrowRight" ? 0.1 : -0.1))));
        }}
        onPointerDown={drag}
        title={movable ? "Drag to choose which part plays" : undefined}
        className={`relative flex h-14 touch-none select-none items-center gap-[2px] ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {(peaks ?? Array.from({ length: BARS }, () => 0.2)).map((h, i) => (
          <span key={i} className={`flex-1 rounded-full ${inWin(i) ? "bg-soundtrack" : "bg-soundtrack/20"}`} style={{ height: `${h * 100}%` }} />
        ))}
        {/* the part that plays */}
        <span className="pointer-events-none absolute inset-y-0 rounded-lg border-2 border-soundtrack" style={{ left: `${(from / total) * 100}%`, width: `${(win / total) * 100}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[13px] tabular-nums text-soft">
        <span>
          Plays {fmtTime(from)} to {fmtTime(from + win)} of the song
        </span>
        <span>{fmtTime(total)}</span>
      </div>
    </div>
  );
}

/** Volume as a small speaker button; the slider opens on click. */
function VolumeButton({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [open]);
  const Icon = value === 0 ? VolumeX : value < 50 ? Volume1 : Volume2;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Volume" title="Volume" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-accent">
        <Icon className="h-4 w-4" />
      </button>
      {open && (
        <div className="fade-in absolute right-0 top-full z-30 mt-1 flex w-56 items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.14)]">
          <input type="range" aria-label="Sound volume" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--accent)]" />
          <span className="w-7 text-right text-[13px] tabular-nums text-soft">{value}</span>
        </div>
      )}
    </div>
  );
}

/** Real songs (top chart by default, or search), each a 30-second clip of the song: ▶ to listen, Use to pick. */
function SongBrowser({ busyId, onClose, onUse }: { busyId: number | null; onClose: () => void; onUse: (song: Song) => void }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"viral" | "top">("viral");
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  // Top songs on open; search 350ms after typing stops.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(
      () => {
        fetch(`/api/songs${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : tab === "top" ? "?list=top" : ""}`)
          .then(async (r) => {
            const data = (await r.json()) as Song[] | { error: string };
            if (!alive) return;
            if (Array.isArray(data)) {
              setSongs(data);
              setError(null);
            } else setError(data.error);
          })
          .catch(() => alive && setError("Songs are not available right now"));
      },
      q ? 350 : 0
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, tab]);
  function toggle(song: Song) {
    audio.current?.pause();
    if (playing === song.id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(song.preview);
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(song.id);
  }
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
      <div className="fade-in flex h-[min(760px,90vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_64px_rgba(15,23,42,0.25)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-[18px] font-extrabold tracking-tight">Choose a song</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 pb-2 pt-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search songs or artists"
            className="w-full rounded-lg border-[1.5px] border-line-strong bg-panel px-3 py-2 text-[14px] outline-none placeholder:text-soft focus:border-accent"
          />
          {q.trim() ? (
            <div className="mt-3 text-[13px] font-semibold text-soft">Results</div>
          ) : (
            <div className="mt-3 flex gap-5 border-b border-line text-[13.5px] font-semibold">
              {(
                [
                  ["viral", "Trending"],
                  ["top", "Top songs"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setSongs(null);
                    setTab(id);
                  }}
                  className={`-mb-px border-b-2 pb-2 ${tab === id ? "border-ink text-text" : "border-transparent text-soft hover:text-text"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          {error && <p className="px-2 py-3 text-[13px] font-semibold text-red-600">{error}</p>}
          {!songs && !error && <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-soft" />}
          {songs?.length === 0 && <p className="px-2 py-3 text-[13px] text-soft">No songs found</p>}
          {songs?.map((song) => (
            <div key={song.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-raised">
              <button type="button" onClick={() => toggle(song)} aria-label={playing === song.id ? "Pause" : "Play"} className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-ink">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={song.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
                  {playing === song.id ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{song.title}</div>
                <div className="truncate text-[13px] text-soft">{song.artist}</div>
              </div>
              <button type="button" disabled={busyId !== null} onClick={() => onUse(song)} className="flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-[13px] font-bold text-text hover:border-accent hover:text-accent disabled:opacity-60">
                {busyId === song.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Use
              </button>
            </div>
          ))}
        </div>
        <p className="border-t border-line px-5 py-2.5 text-[11.5px] leading-snug text-soft">
          Due to copyright, songs here are 30s previews. For the full song, upload your own mp3, or pick the song in Instagram or TikTok when you post.
        </p>
      </div>
    </div>
  );
}

/** How to film one demo clip (optional tips): camera setup and steps in order. */
function ShotBrief({ clip }: { clip: DemoClip }) {
  return (
    <div className="space-y-1.5 pb-4 pl-[62px] pr-4">
      {clip.camera && (
        <div className="flex items-start gap-2 text-[13px] text-text">
          <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          {clip.camera}
        </div>
      )}
      {clip.steps?.length ? (
        <ol className="space-y-1">
          {clip.steps.map((step, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug text-muted">
              <span className="w-3.5 shrink-0 text-right tabular-nums text-soft">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Step 4: one finished demo video, or a shot list filmed clip by clip. Every clip opens in the same ClipEditor as the hook. */
function DemoStep({ run, segs, renderEditor, onFiles, onClips, onUpload, onRename, onDelete, onMove, onReset }: {
  run: Run;
  segs: Seg[];
  renderEditor: (seg: Seg) => React.ReactNode;
  /** One video = one demo; several = clips in file-name order. */
  onFiles: (files: File[]) => Promise<void>;
  onClips: () => void;
  onUpload: (id: string, f: File) => Promise<void>;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  /** Move a clip to a new position (0-based). */
  onMove: (id: string, to: number) => void;
  onReset: () => void;
}) {
  const clips = demoClips(run);
  // Reordering: the clip being dragged, and where it would land (index to insert before).
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const mode = run.demo.mode ?? (clips.length ? "single" : undefined);
  const [busy, setBusy] = useState<string | null>(null); // clip id (or "single") being uploaded
  const [openId, setOpenId] = useState<string | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null); // which "How to film" is open
  const [error, setError] = useState<string | null>(null);

  async function take(id: string, f: File | undefined, upload: (f: File) => Promise<void>) {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setError("Please choose a video file.");
      return;
    }
    setError(null);
    setBusy(id);
    try {
      await upload(f);
      if (id !== "single") setOpenId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function takeMany(list: FileList | null) {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("video/"));
    if (!files.length) {
      if (list?.length) setError("Please choose video files.");
      return;
    }
    setError(null);
    setBusy("single");
    try {
      await onFiles(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  const fileInput = (id: string, onFile: (f: File) => Promise<void>) => (
    <input type="file" accept="video/*" className="hidden" onChange={(e) => void take(id, e.target.files?.[0], onFile).then(() => (e.target.value = ""))} />
  );

  if (!mode) {
    return (
      <div className="rounded-2xl border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2.5 p-4">
          <label className={`btn-primary cursor-pointer px-4 py-2.5 text-[14px] ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy === "single" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload your demo
            <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => void takeMany(e.target.files).then(() => (e.target.value = ""))} />
          </label>
          <button type="button" onClick={onClips} className={optionBtn(false)}>
            <ListOrdered className="h-4 w-4" />
            Build it clip by clip
          </button>
        </div>
        {error && <p className="border-t border-line px-4 py-2.5 text-[13px] font-semibold text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {clips.map((c, i) => {
        const seg = segs.find((s) => s.id === c.id);
        const open = openId === c.id && Boolean(seg);
        return (
          <div
            key={c.id}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dropAt !== null) {
                const from = clips.findIndex((x) => x.id === dragId);
                onMove(dragId, dropAt > from ? dropAt - 1 : dropAt);
              }
              setDragId(null);
              setDropAt(null);
            }}
            className={`relative rounded-2xl border bg-panel ${open ? "border-line-strong" : "border-line"} ${dragId === c.id ? "opacity-40" : ""}`}
          >
            {/* where the dragged clip will land */}
            {dragId && dropAt === i && <span className="pointer-events-none absolute -top-[7px] left-2 right-2 h-[3px] rounded-full bg-accent" />}
            {dragId && dropAt === i + 1 && i === clips.length - 1 && <span className="pointer-events-none absolute -bottom-[7px] left-2 right-2 h-[3px] rounded-full bg-accent" />}
            <div className="flex items-center gap-3 py-3.5 pl-1.5 pr-4">
              {clips.length > 1 && (
                <button
                  type="button"
                  draggable
                  aria-label={`Move clip ${i + 1}`}
                  title="Drag to reorder (or use the arrow keys)"
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", c.id);
                    const row = e.currentTarget.closest("[class*='rounded-2xl']");
                    if (row instanceof HTMLElement) e.dataTransfer.setDragImage(row, 24, 24);
                    setDragId(c.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropAt(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); onMove(c.id, i - 1); }
                    if (e.key === "ArrowDown" && i < clips.length - 1) { e.preventDefault(); onMove(c.id, i + 1); }
                  }}
                  className="flex h-9 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-soft hover:bg-raised hover:text-text active:cursor-grabbing"
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              )}
              {clipSrc(c) ? (
                <button type="button" onClick={() => setOpenId(open ? null : c.id)} aria-label={open ? "Close clip" : "Edit clip"} className="relative shrink-0">
                  <video src={`${clipSrc(c)}#t=0.5`} muted preload="metadata" className="h-[56px] w-[32px] rounded-md bg-ink object-cover" />
                  <span className="absolute -left-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent text-[10.5px] font-black text-white">{i + 1}</span>
                </button>
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-[13px] font-bold text-muted">{i + 1}</span>
              )}
              <div className="min-w-0 flex-1">
                {/* Title, then its length right after it; the tips toggle starts under the title. */}
                <div className="flex items-baseline gap-2">
                  <input
                    value={c.label}
                    maxLength={60}
                    onChange={(e) => onRename(c.id, e.target.value)}
                    aria-label={`Clip ${i + 1} name`}
                    className="min-w-0 bg-transparent text-[14px] font-semibold outline-none [field-sizing:content]"
                  />
                  <span className="shrink-0 text-[13px] tabular-nums text-soft">{seg ? `${seg.len.toFixed(1)}s` : c.target ? `~${c.target}s` : ""}</span>
                </div>
                {!open && (c.camera || c.steps?.length) ? (
                  <button
                    type="button"
                    onClick={() => setBriefId(briefId === c.id ? null : c.id)}
                    aria-expanded={briefId === c.id}
                    className="mt-0.5 flex items-center gap-1 text-[13px] leading-5 text-soft hover:text-accent"
                  >
                    How to film (optional)
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${briefId === c.id ? "rotate-180" : ""}`} />
                  </button>
                ) : !c.steps?.length && c.hint ? (
                  <div className="mt-0.5 truncate text-[13px] leading-5 text-soft">{c.hint}</div>
                ) : null}
              </div>
              {clipSrc(c) ? (
                <>
                  <label title="Replace video" aria-label="Replace video" className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-accent ${busy ? "pointer-events-none opacity-60" : ""}`}>
                    {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
                    {fileInput(c.id, (f) => onUpload(c.id, f))}
                  </label>
                  <button type="button" onClick={() => setOpenId(open ? null : c.id)} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
                    {open ? "Done" : "Edit"}
                  </button>
                </>
              ) : (
                <label className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-[13px] font-bold text-text hover:border-accent hover:text-accent ${busy ? "pointer-events-none opacity-60" : ""}`}>
                  {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Upload clip
                  {fileInput(c.id, (f) => onUpload(c.id, f))}
                </label>
              )}
              <button type="button" onClick={() => onDelete(c.id)} aria-label={`Delete clip ${i + 1}`} className="rounded-lg p-2 text-soft hover:bg-red-50 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {!open && briefId === c.id && (
              <ShotBrief clip={c} />
            )}
            {open && seg && (
              <div className="border-t border-line p-3">
                {renderEditor(seg)}
              </div>
            )}
          </div>
        );
      })}
      {error && <p className="text-[13px] font-semibold text-red-600">{error}</p>}
      <div className="flex items-center justify-between pt-1">
        {/* Picks one or more videos; each becomes a clip at the end. */}
        <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-muted hover:bg-raised hover:text-accent ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy === "single" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add clip
          <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => void takeMany(e.target.files).then(() => (e.target.value = ""))} />
        </label>
        <button type="button" onClick={onReset} className="rounded-lg px-2 py-1.5 text-[13px] font-semibold text-soft hover:text-text">
          Start over
        </button>
      </div>
    </div>
  );
}

/** Step 3 Advanced settings: brightness, contrast, saturation, warmth and zoom of the hook clip. */
function AdvancedSettings({ value, disabled, onChange, motion, keyOn, onMotion, onKey, defaultOpen = false }: {
  value?: Partial<Adjust>;
  disabled: boolean;
  onChange: (a: Partial<Adjust>) => void;
  /** Zoom / position at the playhead (keyframes applied). */
  motion: Motion;
  keyOn: boolean;
  onMotion: (p: Partial<Motion>) => void;
  onKey: () => void;
  /** Start open (the full editor shows the settings right away). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const v = fullAdjust(value);
  const hasKeys = v.keys.length > 0;
  const set = (key: AdjustRow["key"], n: number) => {
    const row = ADJUST_ROWS.find((r) => r.key === key);
    if (!row || Number.isNaN(n)) return;
    const snapped = Number((Math.round(Math.max(row.min, Math.min(row.max, n)) / row.step) * row.step).toFixed(2));
    if (key === "zoom") onMotion({ zoom: snapped });
    else onChange({ ...v, [key]: snapped });
  };
  return (
    <div className="space-y-2">
      {/* Icon only; the name shows on hover. Accent when open or when something is changed. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Advanced settings"
        title="Advanced settings"
        className={`flex h-10 w-10 items-center justify-center rounded-xl border ${open || isAdjusted(value) ? "border-accent bg-accent-tint text-accent" : "border-line bg-panel text-muted hover:border-line-strong hover:text-text"}`}
      >
        <SlidersHorizontal className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <div className={`space-y-3 rounded-2xl border border-line bg-panel px-4 pb-4 pt-3 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-text">Flip</span>
            <button
              type="button"
              role="switch"
              aria-checked={v.flip}
              aria-label="Flip"
              onClick={() => onChange({ ...v, flip: !v.flip })}
              className={`relative h-5 w-9 rounded-full transition-colors ${v.flip ? "bg-accent" : "bg-line-strong"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${v.flip ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </div>
          {ADJUST_ROWS.map((r) => {
            const n = r.key === "zoom" ? motion.zoom : v[r.key];
            const def = NO_ADJUST[r.key];
            return (
              <div key={r.key}>
                {/* pr-7 = the diamond column, so Center / Reset line up with the number box */}
                <div className="mb-1 flex items-baseline justify-between pr-7">
                  <span className="text-[13px] font-medium text-text">{r.label}</span>
                  <span className="flex items-center gap-2.5">
                    {r.key === "zoom" && (motion.panX !== 0 || motion.panY !== 0) && (
                      <button type="button" onClick={() => onMotion({ panX: 0, panY: 0 })} className="text-[11.5px] font-semibold text-soft hover:text-accent">
                        Center
                      </button>
                    )}
                    {(n !== def || (r.key === "zoom" && hasKeys)) && (
                      <button type="button" onClick={() => (r.key === "zoom" ? onChange({ ...v, zoom: 0, panX: 0, panY: 0, keys: [] }) : set(r.key, def))} className="text-[11.5px] font-semibold text-soft hover:text-accent">
                        Reset
                      </button>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    aria-label={r.label}
                    min={r.min}
                    max={r.max}
                    step={r.step}
                    value={n}
                    onChange={(e) => set(r.key, Number(e.target.value))}
                    onDoubleClick={() => set(r.key, def)}
                    className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--accent)]"
                  />
                  <span className="relative">
                    <input
                      type="number"
                      aria-label={`${r.label} value`}
                      min={r.min}
                      max={r.max}
                      step={r.step}
                      value={r.key === "zoom" ? Math.round(n) : n}
                      onChange={(e) => set(r.key, Number(e.target.value))}
                      className={`w-14 rounded-lg border border-line bg-raised py-1 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none text-[13px] tabular-nums outline-none focus:border-accent ${r.key === "speed" ? "pl-1 pr-3.5" : "px-2"}`}
                    />
                    {r.key === "speed" && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12.5px] text-soft">x</span>}
                  </span>
                  {r.key === "zoom" ? (
                    <button
                      type="button"
                      onClick={onKey}
                      aria-label={keyOn ? "Remove keyframe" : "Add keyframe"}
                      title={keyOn ? "Remove keyframe" : "Add keyframe at the playhead"}
                      className={`-mx-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-raised ${hasKeys ? "text-accent" : "text-soft hover:text-text"}`}
                    >
                      <Diamond className="h-3.5 w-3.5" fill={keyOn ? "currentColor" : "none"} strokeWidth={2.2} />
                    </button>
                  ) : (
                    <span className="-mx-1 w-6" aria-hidden />
                  )}
                </div>
              </div>
            );
          })}
          {isAdjusted(value) && (
            <button type="button" onClick={() => onChange({ ...NO_ADJUST })} className="text-[12.5px] font-semibold text-muted hover:text-accent">
              Reset all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** One on-screen text: field, emoji, ▾ for font / color / style, and + / delete. */
function TextRow({ t, placeholder, onPatch, onAdd, onRemove, onApplyAll }: { t: TextLayer; placeholder: string; onPatch: (p: Partial<TextLayer>) => void; onAdd: () => void; onRemove: () => void; onApplyAll?: () => void }) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  const textInput = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-2xl border border-line bg-panel">
      <div className="flex items-center gap-1 p-1.5 pl-3">
        <input
          ref={textInput}
          value={t.text}
          maxLength={160}
          onChange={(e) => onPatch({ text: e.target.value })}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent py-2 text-[14px] outline-none placeholder:text-soft"
        />
        <EmojiMenu
          onPick={(emoji) => {
            const el = textInput.current;
            const at = el?.selectionStart ?? t.text.length;
            const end = el?.selectionEnd ?? at;
            onPatch({ text: (t.text.slice(0, at) + emoji + t.text.slice(end)).slice(0, 160) });
            requestAnimationFrame(() => {
              el?.focus();
              el?.setSelectionRange(at + emoji.length, at + emoji.length);
            });
          }}
        />
        <button type="button" aria-label="Text style" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-lg p-2 text-muted hover:bg-raised hover:text-text">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
        <button type="button" aria-label="Add text" title="Add text" onClick={onAdd} className="rounded-lg p-2 text-muted hover:bg-raised hover:text-accent">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Delete text" title="Delete text" onClick={onRemove} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 border-t border-line p-2">
          <FontMenu value={t.font} onChange={(font) => onPatch({ font })} />
          <Menu title="Text color" label={<span className="block h-5 w-5 rounded-full border border-line-strong" style={{ background: t.color }} />}>
            {(close) => <ColorGrid value={t.color} onPick={(c, done) => { onPatch({ color: c }); if (done) close(); }} />}
          </Menu>
          <Menu label={stylePreset(t.style).label}>
            {(close) => (
              <div className="max-h-[360px] w-[344px] overflow-y-auto p-2">
                {STYLE_GROUPS.map((g) => (
                  <div key={g} className="mb-3 last:mb-0">
                    <div className="px-1 pb-1.5 text-[11.5px] font-semibold text-soft">{g}</div>
                    <div className="grid grid-cols-4 gap-2">
                      {STYLE_PRESETS.filter((p) => p.group === g).map((p) => {
                        // Previews use fixed, high-contrast demo colors so every outline / box / glow is visible.
                        const look = p.look("#ffffff", t.second ?? "#7b4cfa");
                        const on = t.style === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            title={p.label}
                            onClick={() => {
                              onPatch({ style: p.id });
                              close();
                            }}
                            className="group flex flex-col items-center gap-1"
                          >
                            <span className={`flex h-12 w-full items-center justify-center overflow-hidden rounded-lg bg-[linear-gradient(135deg,#6b7280,#9ca3af)] ${on ? "ring-2 ring-accent ring-offset-1" : "group-hover:ring-1 group-hover:ring-line-strong"}`}>
                              <span className="text-[18px] font-extrabold leading-none" style={{ fontFamily: fontCss(t.font), ...look.text, ...(look.box ?? {}) }}>
                                Aa
                              </span>
                            </span>
                            <span className={`w-full truncate text-center text-[11px] ${on ? "font-bold text-accent" : "font-medium text-muted"}`}>{p.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Menu>
          {stylePreset(t.style).second && (
            <Menu title={stylePreset(t.style).second} label={<span className="block h-5 w-5 rounded-full border border-line-strong" style={{ background: t.second ?? autoSecond(t.color) }} />}>
              {(close) => <ColorGrid value={t.second ?? autoSecond(t.color)} onPick={(c, done) => { onPatch({ second: c }); if (done) close(); }} />}
            </Menu>
          )}
          {onApplyAll && (
            <button
              type="button"
              title="Give every text in the video this look and position"
              onClick={() => {
                onApplyAll();
                setApplied(true);
                setTimeout(() => setApplied(false), 1800);
              }}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-line-strong bg-panel px-3 py-1.5 text-[13px] font-semibold text-text hover:border-accent hover:text-accent"
            >
              {applied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
              {applied ? "Applied" : "Apply to all"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A clip that plays only its pieces (file times), back to back, looping. onTime gets on-screen seconds from its start. */
function TrimmedVideo({ src, parts, muted = false, adjust, rate = 1, onTime }: { src: string; parts: Part[]; muted?: boolean; adjust?: Partial<Adjust>; rate?: number; onTime?: (rel: number) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const who = useId();
  const [playing, setPlaying] = useState(true);
  usePlaybackClaims(who, setPlaying);
  useEffect(() => { if (!muted) claimPlayback(who); }, [who, muted]);
  useEffect(() => { if (!playing) ref.current?.pause(); }, [playing]);
  useEffect(() => { if (ref.current) ref.current.volume = fullAdjust(adjust).volume / 100; }, [adjust]);
  const style = videoStyle(adjust, parts[0]?.start ?? 0);
  const timeRef = useRef(onTime);
  useEffect(() => {
    timeRef.current = onTime;
  });
  // Keyframed zoom / position: follow the video's own clock.
  useEffect(() => {
    if (!playing || !fullAdjust(adjust).keys.length) return;
    let raf = 0;
    const frame = () => {
      const v = ref.current;
      if (v) v.style.transform = videoStyle(adjust, v.currentTime)?.transform ?? "";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [adjust, playing]);
  const key = JSON.stringify(parts.map((p) => [p.start, p.end]));
  useEffect(() => {
    const v = ref.current;
    const ps = JSON.parse(key) as [number, number][];
    if (!v || !ps.length) return;
    v.playbackRate = rate;
    let i = ps.findIndex(([a, b]) => v.currentTime >= a - 0.01 && v.currentTime < b);
    if (i < 0) {
      i = 0;
      v.currentTime = ps[0][0];
    }
    if (playing) void v.play().catch(() => undefined);
    let raf = 0;
    const frame = () => {
      const [a, b] = ps[i];
      if (v.ended || v.currentTime >= b - 0.02) {
        i = (i + 1) % ps.length;
        v.currentTime = ps[i][0];
        if (playing) void v.play().catch(() => undefined);
      } else if (v.currentTime < a - 0.1) v.currentTime = a;
      const before = ps.slice(0, i).reduce((t, [x, y]) => t + (y - x), 0);
      timeRef.current?.((before + Math.max(0, v.currentTime - ps[i][0])) / rate);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [key, rate, playing]);
  return <video ref={ref} src={src} autoPlay={playing} muted={muted} loop playsInline className="absolute inset-0 h-full w-full object-cover" style={style} />;
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;

/**
 * Drag a text bar on a timeline `rect` that is `len` seconds wide: move it, or stretch / shrink it from either
 * end (like CapCut), with a magnet (12px) to `points`. `onStart` runs on the first real move (one undo step).
 */
function dragTextBar(e: React.PointerEvent, rect: DOMRect, len: number, x: TextLayer, mode: "move" | "left" | "right", points: number[], onTiming: (id: string, p: { start?: number; end?: number }) => void, setGuide: (v: number | null) => void, onStart?: () => void, scale = len) {
  e.preventDefault();
  e.stopPropagation();
  const sx = e.clientX;
  const { start, end } = x;
  const size = end - start;
  const tol = (12 / rect.width) * scale;
  const snap = magnet(points, tol);
  const snapEnd = magnet(points, tol);
  let started = false;
  const move = (ev: PointerEvent) => {
    if (!started) {
      if (Math.abs(ev.clientX - sx) < 2) return;
      started = true;
      onStart?.();
    }
    const d = ((ev.clientX - sx) / rect.width) * scale;
    if (mode === "move") {
      const raw = start + d;
      const a = snap(raw);
      const b = snapEnd(raw + size);
      const ns = a !== null && (b === null || Math.abs(a - raw) <= Math.abs(b - raw - size)) ? a : b !== null ? b - size : round1(raw);
      const clamped = Math.max(0, Math.min(len - size, ns));
      setGuide(a !== null && clamped === a ? a : b !== null && clamped === b - size ? b : null);
      onTiming(x.id, { start: clamped, end: clamped + size });
    } else if (mode === "left") {
      const p = snap(start + d);
      const v = Math.max(0, Math.min(end - 0.3, p ?? round1(start + d)));
      setGuide(p !== null && v === p ? p : null);
      onTiming(x.id, { start: v });
    } else {
      const p = snap(end + d);
      const v = Math.min(len, Math.max(start + 0.3, p ?? round1(end + d)));
      setGuide(p !== null && v === p ? p : null);
      onTiming(x.id, { end: v });
    }
  };
  const up = () => {
    setGuide(null);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Player bar under a clip: play/pause, time, ruler, the clip's pieces side by side (Cut splits the piece under
 *  the playhead; the selected piece has trim handles and can be deleted), text bars, keyframes, Undo. */
function ClipControls({ label, playing, onPlay, t, len, pieces, selected, onSelect, draft, onTrim, onTrimEnd, onDelete, onSeek, onCut, canCut, texts, onTiming, keys, onKeyMove, canUndo, onUndo }: {
  label: string;
  playing: boolean;
  onPlay: () => void;
  t: number;
  len: number;
  /** The clip's pieces, on-screen: where each starts and how long it plays. */
  pieces: { id: string; at: number; len: number }[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** Piece i being trimmed: its kept window [a, b] on the bar, until the handle is let go. */
  draft: { i: number; a: number; b: number } | null;
  onTrim: (i: number, v: [number, number], edge: number) => void;
  /** A trim handle was let go (or nudged with the keyboard): apply this window to piece i. */
  onTrimEnd: (i: number, v: [number, number]) => void;
  /** Delete the selected piece (only when the clip has more than one). */
  onDelete?: () => void;
  onSeek: (t: number) => void;
  onCut: () => void;
  canCut: boolean;
  texts: TextLayer[];
  onTiming: (id: string, p: { start?: number; end?: number }) => void;
  /** Zoom keyframes: i = index in time order, at = on-screen seconds. */
  keys: { i: number; at: number }[];
  onKeyMove: (i: number, at: number) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [guide, setGuide] = useState<number | null>(null); // snap line while dragging a text
  const si = pieces.length === 1 ? 0 : pieces.findIndex((x) => x.id === selected);
  const sp = pieces[si];
  const [a, b] = !sp ? [0, 0] : draft?.i === si ? [draft.a, draft.b] : [sp.at, sp.at + sp.len];
  const lo = sp?.at ?? 0;
  const hi = sp ? sp.at + sp.len : 0;
  const pct = (v: number) => `${(v / len) * 100}%`;
  function track(e: React.PointerEvent, on: (sec: number) => void, done?: () => void) {
    e.preventDefault();
    e.stopPropagation();
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    const at = (x: number) => Math.max(0, Math.min(len, ((x - rect.left) / rect.width) * len));
    on(at(e.clientX));
    const move = (ev: PointerEvent) => on(at(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      done?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const handle = "absolute inset-y-0 z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-ink";
  /** Diamond: click = jump there, drag = move it in time. */
  function dragKey(e: React.PointerEvent, k: { i: number; at: number }) {
    e.preventDefault();
    e.stopPropagation();
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return;
      moved = true;
      const at = Math.max(0, Math.min(len, k.at + ((ev.clientX - sx) / rect.width) * len));
      onKeyMove(k.i, at);
      onSeek(at);
    };
    const up = () => {
      if (!moved) onSeek(k.at);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  /** Drag a text bar: move it, or stretch / shrink it from either end (like CapCut). */
  function dragText(e: React.PointerEvent, x: TextLayer, mode: "move" | "left" | "right") {
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    // Snap to the clip's start and end, the pieces, the playhead, and other texts' edges.
    dragTextBar(e, rect, len, x, mode, [0, len, t, ...pieces.map((p) => p.at), ...texts.filter((o) => o.id !== x.id).flatMap((o) => [o.start, o.end])], onTiming, setGuide);
  }
  return (
    <div className="w-full rounded-2xl border border-line bg-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={onPlay} className="btn-primary h-7 w-7 rounded-full p-0" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />}
        </button>
        <span className="text-[12.5px] tabular-nums text-muted">
          {clock(t)} / {clock(len)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {canUndo && (
            <button type="button" onClick={onUndo} title="Undo" aria-label="Undo" className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-text">
              <Undo2 className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} title="Delete this piece (Delete)" aria-label="Delete piece" className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-text">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            disabled={!canCut}
            onClick={onCut}
            title="Cut the clip in two at the playhead"
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] font-bold text-text hover:border-accent hover:text-accent disabled:border-transparent disabled:text-soft"
          >
            <Scissors className="h-3.5 w-3.5" />
            Cut
          </button>
        </div>
      </div>

      <div ref={area} className="relative select-none">
        <div className="relative h-4 cursor-pointer" onPointerDown={(e) => track(e, onSeek)}>
          {Array.from({ length: Math.floor(len * 2) + 1 }, (_, i) => (
            <span key={i} className={`absolute top-0 w-px bg-line ${i % 2 ? "h-1" : "h-1.5"}`} style={{ left: pct(i / 2) }} />
          ))}
        </div>
        <div className="relative h-9 cursor-pointer overflow-hidden rounded-md bg-[repeating-linear-gradient(135deg,var(--raised),var(--raised)_4px,var(--line)_4px,var(--line)_6px)]" onPointerDown={(e) => track(e, onSeek)}>
          {/* the pieces, side by side (one until the clip is Cut) */}
          {pieces.map((p, i) => {
            // While trimming, the piece keeps its start and the pieces after it slide along (no gap).
            const cutBy = draft ? pieces[draft.i].len - (draft.b - draft.a) : 0;
            const [pa, pb] = draft?.i === i ? [p.at, p.at + draft.b - draft.a] : draft && i > draft.i ? [p.at - cutBy, p.at + p.len - cutBy] : [p.at, p.at + p.len];
            const on = pieces.length > 1 && p.id === selected;
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={pieces.length > 1 ? `Piece ${i + 1}` : label}
                aria-pressed={pieces.length > 1 ? on : undefined}
                title={pieces.length > 1 ? "Click to select. Delete removes it." : undefined}
                onPointerDown={(e) => {
                  e.currentTarget.focus();
                  onSelect(p.id);
                  track(e, onSeek);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Delete" || e.key === "Backspace") && onDelete) {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete();
                  }
                }}
                className={`absolute inset-y-0 flex items-center px-4 text-[10.5px] font-bold text-white outline-none ${selected && pieces.length > 1 && !on ? "bg-[#a39eb5]" : "bg-[#221d33]"} ${i > 0 ? "border-l-2 border-panel" : ""} ${on ? "ring-2 ring-inset ring-accent" : ""}`}
                style={{ left: pct(pa), width: `calc(${pct(pb)} - ${pct(pa)})` }}
              >
                <span className="truncate">{pieces.length > 1 ? `${label} ${i + 1}` : label}</span>
              </div>
            );
          })}
          {keys.map((k) => (
            <span
              key={k.i}
              role="button"
              tabIndex={0}
              aria-label={`Keyframe at ${k.at.toFixed(1)}s`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSeek(k.at); }
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); onKeyMove(k.i, Math.max(0, Math.min(len, k.at + (e.key === "ArrowRight" ? 0.1 : -0.1)))); }
              }}
              title="Click to jump, drag to move"
              onPointerDown={(e) => dragKey(e, k)}
              className={`absolute top-1/2 z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-pointer touch-none rounded-[2px] border-[1.5px] border-ink ${Math.abs(k.at - t) < 0.06 ? "bg-ink" : "bg-white"}`}
              style={{ left: pct(k.at) }}
            />
          ))}
          {sp && (
            <>
              <span
                role="slider"
                tabIndex={0}
                aria-label="Trim start"
                aria-valuemin={lo}
                aria-valuemax={hi}
                aria-valuenow={a}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault(); e.stopPropagation();
                  const next = Math.max(lo, Math.min(b - 0.3, round1(a + (e.key === "ArrowRight" ? 0.1 : -0.1))));
                  onTrimEnd(si, [next, b]);
                }}
                onPointerDown={(e) => {
                  let last: [number, number] = [a, b];
                  track(e, (v) => { const x = Math.max(lo, Math.min(b - 0.3, round1(v))); last = [x, b]; onTrim(si, last, x); }, () => onTrimEnd(si, last));
                }}
                className={`${handle} rounded-l-md`}
                style={{ left: pct(lo) }}
              >
                <span className="h-3.5 w-0.5 rounded-full bg-white" />
              </span>
              <span
                role="slider"
                tabIndex={0}
                aria-label="Trim end"
                aria-valuemin={lo}
                aria-valuemax={hi}
                aria-valuenow={b}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault(); e.stopPropagation();
                  const next = Math.min(hi, Math.max(a + 0.3, round1(b + (e.key === "ArrowRight" ? 0.1 : -0.1))));
                  onTrimEnd(si, [a, next]);
                }}
                onPointerDown={(e) => {
                  let last: [number, number] = [a, b];
                  const rect = area.current?.getBoundingClientRect();
                  // The end snaps (12px) to the playhead, the pieces and the texts.
                  const snap = magnet([t, ...pieces.map((q) => q.at), ...texts.flatMap((o) => [o.start, o.end])], rect ? (12 / rect.width) * len : 0);
                  track(e, (v) => {
                    const sn = snap(v);
                    const x = Math.min(hi, Math.max(a + 0.3, sn ?? round1(v)));
                    setGuide(sn !== null && x === sn ? sn : null);
                    last = [a, x];
                    onTrim(si, last, x);
                  }, () => {
                    setGuide(null);
                    onTrimEnd(si, last);
                  });
                }}
                className={`${handle} -translate-x-full rounded-r-md`}
                style={{ left: pct(lo + b - a) }}
              >
                <span className="h-3.5 w-0.5 rounded-full bg-white" />
              </span>
            </>
          )}
        </div>
        {texts.length > 0 && (
          <div className="mt-1 space-y-1">
            {texts.map((x) => (
              <div key={x.id} className="relative h-6 rounded-md bg-raised/70" onPointerDown={(e) => track(e, onSeek)}>
                <div
                  onPointerDown={(e) => dragText(e, x, "move")}
                  title="Drag to move. Drag the ends to make it longer or shorter."
                  className={`group absolute inset-y-0 flex cursor-grab touch-none items-center gap-1 overflow-hidden rounded-md bg-texttrack-tint px-3.5 text-[10.5px] font-semibold text-texttrack active:cursor-grabbing ${x.start <= 0.05 && x.end >= len - 0.05 ? "ring-1 ring-inset ring-texttrack" : ""}`}
                  style={{ left: pct(Math.min(x.start, len)), width: pct(Math.max(0, Math.min(x.end, len) - Math.min(x.start, len))) }}
                >
                  <Type className="h-3 w-3 shrink-0" />
                  <span className="truncate">{x.text.trim() || (x.id === "hook" ? "Hook text" : "Text")}</span>
                  {/* Clear end caps (purple, unlike the clip trimmer's black ones) so the start and end are easy to grab and to line up. */}
                  <span aria-label="Text start" onPointerDown={(e) => dragText(e, x, "left")} className="absolute inset-y-0 left-0 flex w-2.5 cursor-ew-resize touch-none items-center justify-center rounded-l-md bg-texttrack">
                    <span className="h-2.5 w-px rounded-full bg-white" />
                  </span>
                  <span aria-label="Text end" onPointerDown={(e) => dragText(e, x, "right")} className="absolute inset-y-0 right-0 flex w-2.5 cursor-ew-resize touch-none items-center justify-center rounded-r-md bg-texttrack">
                    <span className="h-2.5 w-px rounded-full bg-white" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-0.5 rounded bg-text" style={{ left: pct(t) }} />
        {guide !== null && <div className="pointer-events-none absolute -bottom-1 -top-1 z-30 w-px -translate-x-1/2 bg-accent" style={{ left: pct(guide) }} />}
      </div>
    </div>
  );
}

/** Stand-in generation length; the Runway job will report its own progress. */
const STANDIN_SECONDS = 10;
const GEN_STAGES = ["Reading the hook", "Matching {who}", "Animating the moves", "Finishing up"];

/** While a hook generates: the character with a scan line, the current stage, a timer and an easing progress bar. */
function GenerateProgress({ photo, who, startedAt, estimate }: { photo: string | null; who: string; startedAt: number; estimate: number }) {
  const [now, setNow] = useState(() => startedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  // Fills fast, then slows; never reaches 100% on its own.
  const progress = Math.min(0.96, 1 - Math.exp((-2.4 * elapsed) / estimate));
  const stage = GEN_STAGES[Math.min(GEN_STAGES.length - 1, Math.floor(progress * GEN_STAGES.length))].replace("{who}", who);
  const clock = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}`;
  return (
    <div className="absolute inset-0 overflow-hidden bg-ink">
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover object-top opacity-45 saturate-50" />
      )}
      <span className="scanline absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-accent/45 to-transparent" />
      <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 p-3 text-white backdrop-blur-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span key={stage} className="fade-in text-[13px] font-bold">{stage}</span>
          <span className="text-[12.5px] tabular-nums text-white/80">{clock}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="mt-1.5 text-[11.5px] text-white/60">About {estimate < 60 ? `${estimate} sec` : `${Math.round(estimate / 60)} min`}</div>
      </div>
    </div>
  );
}

const SWATCHES = ["#ffffff", "#000000", "#facc15", "#f97316", "#ef4444", "#ec4899", "#a78bfa", "#8b5cf6", "#38bdf8", "#22c55e", "#94a3b8", "#fde68a"];

/** 12 swatches + a custom picker. `done` is false while dragging the custom picker (keep the menu open). */
function ColorGrid({ value, onPick }: { value: string; onPick: (c: string, done: boolean) => void }) {
  return (
    <div className="w-[196px] p-2">
      <div className="grid grid-cols-6 gap-1.5">
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={c} onClick={() => onPick(c, true)} className={`h-7 w-7 rounded-full border ${value.toLowerCase() === c ? "border-ink ring-2 ring-accent ring-offset-1" : "border-line-strong"}`} style={{ background: c }} />
        ))}
      </div>
      <label className="mt-2 flex cursor-pointer items-center justify-between rounded-lg px-1.5 py-1 text-[12.5px] font-semibold text-muted hover:bg-raised">
        Custom
        <input type="color" value={value} onChange={(e) => onPick(e.target.value, false)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
      </label>
    </div>
  );
}

const EMOJIS = ("😭 💀 🤯 😂 🤣 😳 🥹 😩 🫠 😮‍💨 😏 🤭 🫢 😱 🙄 😤 🥲 😍 🤩 😎 🤔 🫣 😬 😅 🙃 😇 🤑 🤡 👀 🔥 ✨ 💸 💰 💯 🚀 📈 📉 ✅ ❌ ⚠️ 🚨 💡 🎯 🧠 💻 📱 🖥️ ⌨️ 🤖 ⚡ 💎 🏆 🎉 🙌 👏 🙏 💪 👇 👆 👉 🫵 🤝 ❤️ 💔 💜 🖤 🤍 💅 🧃 ☕ 🍿 📌 📝 🗓️ ⏰ 🎬 🎥 📸 🛒 🏠 🌙 ☀️")
  .split(" ");

function EmojiMenu({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Emoji" aria-expanded={open} onClick={() => { const r = ref.current?.getBoundingClientRect(); setUp(Boolean(r && window.innerHeight - r.bottom < 340 && r.top > 340)); setOpen((o) => !o); }} className="rounded-lg p-2 text-muted hover:bg-raised hover:text-text">
        <Smile className="h-4 w-4" />
      </button>
      {open && (
        <div className={`fade-in absolute right-0 z-30 grid w-[284px] ${up ? "bottom-full mb-1" : "top-full mt-1"} grid-cols-8 gap-0.5 rounded-xl border border-line bg-panel p-2 shadow-[0_8px_24px_rgba(15,23,42,0.14)]`}>
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => onPick(e)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[19px] hover:bg-raised">
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small dropdown: a button and a panel under it; closes on outside click or Escape. */
function Menu({ label, title, children }: { label: React.ReactNode; title?: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        title={title}
        aria-label={title}
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          setUp(Boolean(r && window.innerHeight - r.bottom < 380 && r.top > 380));
          setOpen((o) => !o);
        }}
        className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] font-semibold hover:border-line-strong"
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-soft" />
      </button>
      {open && <div className={`fade-in absolute left-0 z-30 rounded-xl border border-line bg-panel shadow-[0_8px_24px_rgba(15,23,42,0.14)] ${up ? "bottom-full mb-1" : "top-full mt-1"}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

const FONT_PREVIEW_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ";

/** Font dropdown with search; each name is shown in its own font (preview glyphs only, loaded on open). */
function FontMenu({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const [q, setQ] = useState("");
  const list = FONT_CHOICES.filter((f) => f.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Menu label={<span style={{ fontFamily: fontCss(value) }}>{fontLabel(value)}</span>}>
      {(close) => {
        loadFonts(FONT_CHOICES.map((f) => f.id), FONT_PREVIEW_CHARS);
        return (
          <div className="w-[240px]">
            <div className="border-b border-line p-2">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fonts" className="w-full rounded-lg bg-raised px-2.5 py-1.5 text-[13px] outline-none placeholder:text-soft" />
            </div>
            <div className="max-h-[280px] overflow-y-auto p-1">
              {list.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    loadFonts([f.id]);
                    onChange(f.id);
                    close();
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[15px] hover:bg-raised"
                  style={{ fontFamily: fontCss(f.id) }}
                >
                  {f.label}
                  {value === f.id && <Check className="h-4 w-4 text-accent" />}
                </button>
              ))}
              {list.length === 0 && <div className="px-2.5 py-3 text-[13px] text-soft">No fonts match</div>}
            </div>
          </div>
        );
      }}
    </Menu>
  );
}

/** One step of the composer. The header always toggles it; closed steps show a one-line summary. */
function Block({ n, title, done, children, open = true, summary, onToggle }: { n: number; title: string; done: boolean; children: React.ReactNode; open?: boolean; summary?: string; onToggle?: () => void }) {
  return (
    <section className={open ? "space-y-4 py-6" : "py-4"}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${done ? "bg-accent text-white" : open ? "bg-accent-tint text-accent" : "bg-raised text-soft"}`}>
          {done ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
        </span>
        <h2 className={`shrink-0 text-[17px] font-extrabold tracking-tight ${open || done ? "text-text" : "text-soft"}`}>{title}</h2>
        {!open && summary && <span className="min-w-0 truncate text-[13.5px] text-muted">{summary}</span>}
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-soft transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && children}
    </section>
  );
}

function Label({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[12.5px] font-bold text-muted">{children}</span>
      {right}
    </div>
  );
}

/* ---------------- 1. Source: library, upload, or describe ---------------- */

type HookSource = "library" | "upload" | "describe";

/** Text box that saves on blur (and when a chip is picked). */
function NoteField({ label, placeholder, value, onSave, rows = 2, chips, submitLabel, onSubmit }: { label: string; placeholder: string; value: string; onSave: (v: string) => void; rows?: number; chips?: string[]; submitLabel?: string; onSubmit?: (v: string) => void }) {
  const [text, setText] = useState(value);
  const submit = () => text.trim() && onSubmit?.(text.trim());
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-muted">{label}</span>
      <textarea
        value={text}
        rows={rows}
        maxLength={400}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onSave(text.trim())}
        onKeyDown={(e) => {
          if (onSubmit && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="w-full resize-none rounded-xl border border-line bg-panel px-3.5 py-3 text-[14px] leading-relaxed outline-none placeholder:text-soft focus:border-accent"
      />
      {chips && (
        <span className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setText(c);
                onSave(c);
              }}
              className="rounded-full border border-line px-3 py-1 text-[12.5px] font-medium text-muted hover:border-accent hover:text-accent"
            >
              {c}
            </button>
          ))}
        </span>
      )}
      {onSubmit && (
        <span className="mt-3 flex justify-end">
          <button type="button" onClick={submit} disabled={!text.trim()} className="btn-primary px-4 py-2.5 text-[14px] disabled:opacity-50">
            {submitLabel}
          </button>
        </span>
      )}
    </label>
  );
}

/** Curator mode: the founder's machine only (NEXT_PUBLIC_CURATOR=1 in .env.local). */
const CURATOR = process.env.NEXT_PUBLIC_CURATOR === "1";


const STYLES: { id: "all" | "text_music" | "talking"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "text_music", label: "Text + music" },
  { id: "talking", label: "Voiceover" },
];

type Sort = "views" | "likes" | "comments" | "new";
const SORTS: { id: Sort; label: string }[] = [
  { id: "views", label: "Most viewed" },
  { id: "likes", label: "Most liked" },
  { id: "comments", label: "Most comments" },
  { id: "new", label: "Newest" },
];
const sortValue = (r: Reference, sort: Sort): number | string =>
  sort === "views" ? (r.views ?? 0) : sort === "likes" ? (r.likes ?? 0) : sort === "comments" ? (r.comments ?? 0) : (r.postedAt ?? r.createdAt);

/** The hook library grid (step 1 picker panel and the Viral library page). */
export function SourcePicker({ refs, source, onRefsChange, onPick, onClear }: { refs: Reference[]; source: Reference | null; onRefsChange: (r: Reference[]) => void; onPick: (r: Reference) => void; onClear: () => void}) {
  const [sort, setSort] = useState<Sort>("views");
  const [style, setStyle] = useState<"all" | "text_music" | "talking">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Reference | null>(null);

  /** `isNew`: a just-uploaded video that isn't in `refs` yet. */
  async function pick(r: Reference, isNew = false) {
    setError(null);
    if (r.analysis || !r.mediaId) return onPick(r);
    setBusyId(r.id);
    try {
      const analysis = await analyzeVideo(`/api/media/${r.mediaId}`);
      await fetch(`/api/references/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ analysis }) });
      const updated = { ...r, analysis };
      onRefsChange((isNew ? [r, ...refs] : refs).map((x) => (x.id === r.id ? updated : x)));
      onPick(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this video");
    } finally {
      setBusyId(null);
    }
  }

  if (source) {
    return (
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-3">
        <Thumb r={source} className="h-[86px] w-[50px] rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">{source.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            {source.author && <span>@{source.author}</span>}
            {source.views != null && (
              <span className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                {fmtViews(source.views)}
              </span>
            )}
            {!source.mediaId && source.sourceUrl && (
              <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
                Open link
              </a>
            )}
          </div>
        </div>
        <button type="button" onClick={onClear} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
          Change
        </button>
      </div>
    );
  }

  // Pending hooks (not yet fit-checked) are hidden from users; the curator sees them tagged.
  // Dropped hooks stay in the data (training labels) but never show.
  const library = refs.filter((r) => (r.owner ?? "curated") === "curated" && (r.mediaId || r.sourceUrl) && (!r.pending || CURATOR) && r.review?.verdict !== "drop");
  const list = [...library].filter((r) => (style === "all" || r.ai?.style === style)).sort((a, b) => {
    const x = sortValue(a, sort);
    const y = sortValue(b, sort);
    return typeof x === "number" && typeof y === "number" ? y - x : String(y).localeCompare(String(x));
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 border-b border-line">
        <div className="flex gap-6" role="tablist" aria-label="Hook style">
          {STYLES.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={style === o.id}
              onClick={() => setStyle(o.id)}
              className={`-mb-px border-b-2 pb-2.5 text-[14px] font-semibold transition-colors ${style === o.id ? "border-ink text-text" : "border-transparent text-soft hover:text-muted"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 pb-2">
          <SortMenu value={sort} onChange={setSort} />
        </div>
      </div>

      {library.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-panel py-12 text-center text-[14px] text-muted">New hooks are on the way.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
          {list.map((r) => (
            <HookCard key={r.id} r={r} busy={busyId === r.id} disabled={busyId !== null} onPick={() => (!r.mediaId && embedUrl(r) ? setPreview(r) : void pick(r))} />
          ))}
        </div>
      )}
      {error && <p className="text-[13px] text-red-500">{error}</p>}
      {preview && (
        <HookPreview
          r={preview}
          onClose={() => setPreview(null)}
          onUse={() => {
            setPreview(null);
            void pick(preview);
          }}
        />
      )}

    </div>
  );
}

function SortMenu({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13.5px] font-semibold text-text hover:bg-raised"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {SORTS.find((o) => o.id === value)?.label}
        <ChevronDown className={`h-4 w-4 text-soft transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="listbox" className="fade-in absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-line bg-panel p-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
          {SORTS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13.5px] font-medium text-text hover:bg-raised"
            >
              {o.label}
              {o.id === value && <Check className="h-4 w-4 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HookCard({ r, busy, disabled, onPick }: { r: Reference; busy: boolean; disabled: boolean; onPick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative aspect-[9/16] overflow-hidden rounded-xl bg-ink text-left outline-2 outline-offset-2 outline-transparent transition-[outline-color] hover:outline-accent disabled:opacity-60"
    >
      {r.mediaId && hover ? (
        <video src={`/api/media/${r.mediaId}`} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : r.mediaId || r.thumbUrl ? (
        <Thumb r={r} className="absolute inset-0 h-full w-full" />
      ) : (
        <div className="absolute inset-0 flex flex-col p-3 pt-9">
          <span className="text-[30px] font-black leading-none text-accent">&ldquo;</span>
          <p className="line-clamp-6 text-[14px] font-bold leading-snug text-white">{r.title}</p>
        </div>
      )}
      {r.author && <span className="absolute left-2 top-2 max-w-[calc(100%-16px)] truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold text-white group-hover:opacity-0">@{r.author}</span>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-8">
        <div className="flex items-center gap-2.5 text-[12px] font-bold text-white">
          {r.views != null && (
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {fmtViews(r.views)}
            </span>
          )}
          {r.likes != null && (
            <span className="flex items-center gap-1 text-white/80">
              <Heart className="h-3.5 w-3.5" />
              {fmtViews(r.likes)}
            </span>
          )}
        </div>
      </div>
      <span className="absolute inset-x-2 top-2 flex justify-center opacity-0 transition-opacity group-hover:opacity-100">
        <span className="rounded-md bg-white px-2 py-0.5 text-[11.5px] font-bold text-ink">{busy ? "Loading..." : !r.mediaId && embedUrl(r) ? "Preview" : "Use this hook"}</span>
      </span>
    </button>
  );
}

/** The platform's own embed player for a link reference (no download, no storage). */
function embedUrl(r: Reference): string | null {
  try {
    const u = new URL(r.sourceUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (r.platform === "instagram") {
      const i = parts.findIndex((p) => p === "reel" || p === "reels" || p === "p");
      if (i >= 0 && parts[i + 1]) return `https://www.instagram.com/${parts[i] === "p" ? "p" : "reel"}/${parts[i + 1]}/embed`;
    }
    if (r.platform === "youtube") {
      const id = u.hostname.endsWith("youtu.be") ? parts[0] : (u.searchParams.get("v") ?? (parts[0] === "shorts" ? parts[1] : null));
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (r.platform === "tiktok") {
      const i = parts.indexOf("video");
      if (i >= 0 && parts[i + 1]) return `https://www.tiktok.com/embed/v2/${parts[i + 1]}`;
    }
  } catch {
    // Not a valid URL: no preview.
  }
  return null;
}

/** "Mar 21" with the year on a second line. */
function fmtDate(iso?: string): React.ReactNode {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const day = new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <>
      {day}
      <span className="block text-[13px] font-semibold text-muted">{m[1]}</span>
    </>
  );
}

function HookPreview({ r, onClose, onUse }: { r: Reference; onClose: () => void; onUse: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const boosted = isLikelyBoosted(r);
  const cta = commentCta(r.caption);
  const pct = (n: number | null | undefined) => {
    if (!r.views || n == null) return null;
    const v = (100 * n) / r.views;
    return v < 0.01 ? "<0.01%" : `${v.toFixed(v < 0.1 ? 2 : 1)}%`;
  };
  const stats = [
    { label: "Views", value: r.views != null ? fmtViews(r.views) : null },
    { label: boosted ? "Organic likes" : "Likes", value: r.likes != null ? fmtViews(r.likes) : null },
    { label: boosted ? "Organic comments" : "Comments", value: r.comments != null ? fmtViews(r.comments) : null },
    { label: "Posted", value: fmtDate(r.postedAt) },
    { label: "Like rate", value: pct(r.likes) },
    { label: "Comment rate", value: pct(r.comments) },
  ].filter((s) => s.value);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={onClose}>
      <div className="fade-in flex max-h-[94vh] w-full max-w-[880px] overflow-hidden rounded-2xl bg-panel shadow-[0_24px_64px_rgba(0,0,0,0.35)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex w-[400px] shrink-0 justify-center bg-raised">
          <iframe src={embedUrl(r) ?? undefined} title={r.title} className="h-[min(760px,94vh)] w-[400px] border-0" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-6">
          <div className="flex items-start justify-between gap-3">
            {r.author && (
              <a href={`https://www.instagram.com/${r.author}/`} target="_blank" rel="noreferrer" className="text-[13.5px] text-muted hover:text-text">
                <span className="font-bold text-text">@{r.author}</span>
                {r.followers != null && <span> · {fmtViews(r.followers)} followers</span>}
              </a>
            )}
            <button type="button" onClick={onClose} className="-mr-2 -mt-2 ml-auto rounded-lg p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <h3 className="mt-2 text-[22px] font-extrabold leading-tight tracking-tight">{r.title}</h3>
          {(r.ai?.style || boosted) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.ai?.style && (
                <span className="rounded-md border border-line bg-panel px-2 py-0.5 text-[12px] font-semibold text-muted">{r.ai.style === "talking" ? "Voiceover" : "Text + music"}</span>
              )}
              {boosted && (
                <span title="Most views likely came from ads. Instagram's API leaves out likes and comments on ads, so these counts are organic only." className="cursor-help rounded-md border border-line bg-panel px-2 py-0.5 text-[12px] font-semibold text-muted">
                  Likely Boosted
                </span>
              )}
            </div>
          )}

          {stats.length > 0 && (
            <dl className="mt-8 grid grid-cols-3 gap-x-8 gap-y-7">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-[12.5px] font-semibold text-soft">{s.label}</dt>
                  <dd className="mt-1 text-[20px] font-extrabold tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {cta && (
            <div className="mt-7 text-[13.5px]">
              <span className="font-semibold text-soft">CTA </span>
              <span className="font-bold">Comment &ldquo;{cta}&rdquo;</span>
            </div>
          )}
          <div className="mt-auto space-y-2 pt-6">
            {r.summary && (
              <div className="mb-3 rounded-xl border border-line bg-raised px-3.5 py-3">
                <div className="text-[12px] font-semibold text-soft">Summary</div>
                <p className="mt-1 text-[13.5px] leading-snug text-text">
                  {/* **Product** in the summary renders bold. */}
                  {r.summary.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-bold">{part}</strong> : part))}
                </p>
              </div>
            )}
            <button type="button" onClick={onUse} className="btn-primary w-full py-3 text-[15px]">
              Use this hook
            </button>
            <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-[14px] font-bold text-accent hover:bg-accent-tint">
              Open on {PLATFORM_LABEL[r.platform]}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Upload any video to steal its hook (downloaded or screen-recorded). Platform-independent. */
function UploadDrop({ onAdded }: { onAdded: (r: Reference) => void }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("video/")) return setError("That isn't a video file");
    setBusy(true);
    setError(null);
    try {
      const { mediaId } = await uploadFile(file, false);
      const res = await fetch("/api/references", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaId, title: file.name.replace(/\.[^.]+$/, "").slice(0, 120), platform: "other", owner: "user" }),
      });
      const data = (await res.json()) as Reference & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not use this video");
      onAdded(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use this video");
      setBusy(false);
    }
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files[0]);
        }}
        className={`flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-colors ${drag ? "border-accent bg-accent-tint" : "border-line-strong bg-panel hover:border-accent hover:bg-accent-tint/40"} ${busy ? "pointer-events-none" : ""}`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-tint text-accent">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        </span>
        <span className="text-[15px] font-bold">{busy ? "Uploading" : "Drop a video or click to upload"}</span>
        {!busy && <span className="text-[12.5px] text-soft">MP4, MOV or WebM</span>}
        <input type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
      </label>
      {error && <p className="mt-2 text-[13px] text-red-500">{error}</p>}
    </div>
  );
}

function Thumb({ r, className }: { r: Reference; className?: string }) {
  const thumb = r.analysis?.segments[0]?.thumb ?? r.thumbUrl;
  if (thumb)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={thumb} alt="" loading="lazy" decoding="async" className={`object-cover ${className ?? ""}`} />
    );
  if (r.mediaId) return <video src={`/api/media/${r.mediaId}#t=0.5`} muted preload="metadata" className={`object-cover ${className ?? ""}`} />;
  return (
    <span className={`flex items-center justify-center bg-raised text-soft ${className ?? ""}`}>
      <LinkIcon className="h-4 w-4" />
    </span>
  );
}

function HookTiming({ duration, start, end, onChange }: { duration: number; start: number; end: number; onChange: (s: number, e: number) => void }) {
  const max = Math.min(duration, 8);
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="rounded-2xl bg-raised/70 px-4 py-3.5">
      <Label right={<span className="text-[12.5px] font-bold text-accent">{round1(end - start)}s hook</span>}>Hook timing</Label>
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-hover" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent" style={{ left: pct(start), width: pct(end - start) }} />
        {(["start", "end"] as const).map((k) => (
          <input
            key={k}
            type="range"
            min={0}
            max={max}
            step={0.1}
            value={k === "start" ? start : end}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (k === "start") onChange(Math.min(v, end - 0.5), end);
              else onChange(start, Math.max(v, start + 0.5));
            }}
            className="range-thumb pointer-events-none absolute inset-0 h-6 w-full appearance-none bg-transparent"
            aria-label={k === "start" ? "Hook start" : "Hook end"}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[12px] tabular-nums text-muted">
        <span>{fmtTime(start)}</span>
        <span>{fmtTime(end)}</span>
      </div>
    </div>
  );
}

/* ---------------- 2. Face + text ---------------- */

function FacePicker({ face, hasOwnClip, onFace, onOwnClip }: { face: Hook["face"] | null; hasOwnClip: boolean; onFace: (f: Hook["face"]) => void; onOwnClip: (f: File) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Label right={<span className="rounded-md bg-raised px-1.5 py-0.5 text-[10.5px] font-bold text-soft">Face swap not connected</span>}>Face</Label>
      <div className="flex flex-wrap gap-2.5">
        <label className={`relative flex h-[76px] w-[60px] cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border-2 text-[10.5px] font-bold ${face?.kind === "photo" ? "border-accent" : "border-dashed border-line text-muted hover:border-accent-line"}`}>
          {face?.kind === "photo" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${face.mediaId}`} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <>
              <Upload className="h-4 w-4" />
              My face
            </>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const { mediaId } = await uploadFile(f, true);
              onFace({ kind: "photo", mediaId });
            }}
          />
        </label>
        {AVATAR_TONES.map((tones, i) => {
          const on = face?.kind === "ai" && face.index === i;
          return (
            <button key={i} type="button" onClick={() => onFace({ kind: "ai", index: i })} className={`relative h-[76px] w-[60px] overflow-hidden rounded-xl ${on ? "ring-[3px] ring-accent" : "hover:opacity-90"}`}>
              <AvatarPlaceholder tones={tones} />
              {on && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-ink">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
        <label className={`flex h-[76px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 px-3 text-[10.5px] font-bold ${hasOwnClip ? "border-accent bg-accent-tint text-accent" : "border-dashed border-line text-muted hover:border-accent-line"} ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
          {hasOwnClip ? "Own clip added" : "Use my own clip"}
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy(true);
              await onOwnClip(f).finally(() => setBusy(false));
            }}
          />
        </label>
      </div>
    </div>
  );
}

function HookText({ run, onChange }: { run: Run; onChange: (p: Partial<Hook>) => void }) {
  const hook = run.hook;
  const [product, setProduct] = useState<ProductInfo>(loadProduct);
  const [options, setOptions] = useState<string[]>([]);
  const [remixing, setRemixing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function setProductField(patch: Partial<ProductInfo>) {
    const next = { ...product, ...patch };
    setProduct(next);
    try {
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(next));
    } catch {
      // Not critical.
    }
  }

  const input = "w-full rounded-xl border border-line px-3 py-2.5 text-[14px] outline-none placeholder:text-soft focus:border-accent";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Your product</Label>
          <input value={product.name} onChange={(e) => setProductField({ name: e.target.value })} placeholder="Mavya" className={input} />
        </div>
        <div>
          <Label>For who</Label>
          <input value={product.audience} onChange={(e) => setProductField({ audience: e.target.value })} placeholder="SaaS founders" className={input} />
        </div>
      </div>

      <div>
        <Label>Text on the source</Label>
        <input value={hook.original ?? ""} onChange={(e) => onChange({ original: e.target.value })} placeholder="6 yrs paycheck to paycheck and NOT ONE person told me??" className={input} />
      </div>

      <div>
        <Label
          right={
            <button
              type="button"
              onClick={() => {
                setRemixing(true);
                timer.current = setTimeout(() => {
                  setOptions(remixHook(hook.original ?? "", product.name, product.audience));
                  setRemixing(false);
                }, 700);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-ink hover:opacity-90"
            >
              {remixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : options.length ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              Remix for my product
            </button>
          }
        >
          Your hook
        </Label>
        <textarea value={hook.text} onChange={(e) => onChange({ text: e.target.value })} rows={2} className="w-full resize-none rounded-xl border border-line px-3 py-2.5 text-[15px] font-semibold outline-none focus:border-accent" />
        {options.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onChange({ text: o })}
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[13px] font-medium ${hook.text === o ? "border-accent-line bg-accent-tint text-accent" : "border-line hover:border-accent-line"}`}
              >
                {hook.text === o ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} /> : <span className="h-3.5 w-3.5 shrink-0" />}
                {o}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[12.5px] font-bold text-muted">Text position</span>
        <div className="flex gap-1 rounded-xl bg-raised p-1">
          {(["top", "center", "bottom"] as TextPos[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange({ textPos: p, textX: undefined, textY: undefined })}
              className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold capitalize ${(hook.textPos ?? "top") === p && hook.textY === undefined ? "bg-hover text-text shadow-sm" : "text-muted hover:text-text"}`}
            >
              {p}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-soft">or drag it on the preview</span>
      </div>
    </div>
  );
}

/* ---------------- 3. Demo ---------------- */

function DemoPicker({ run, onClip, onClear, onFrame }: { run: Run; onClip: (f: File) => Promise<void>; onClear: () => void; onFrame: (f: Frame) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clip = run.demo.clip;
  async function take(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    await onClip(f).catch((err: unknown) => setError(err instanceof Error ? err.message : "Upload failed"));
    setBusy(false);
  }
  return (
    <div className="space-y-4">
      {clip ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3">
          <Film className="h-5 w-5 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{clip.name}</span>
          {clip.length !== null && <span className="text-[12.5px] text-muted">{fmtTime(clip.length)}</span>}
          <button type="button" onClick={onClear} className="rounded-lg p-1 text-soft hover:bg-raised hover:text-text" aria-label="Remove demo">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void take(e.dataTransfer.files?.[0]);
          }}
          className={`flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-[14px] font-semibold text-muted hover:border-accent-line hover:bg-accent-tint/40 hover:text-accent ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          Drop your screen recording
          <input
            type="file"
            accept="video/*,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void take(f);
            }}
          />
        </label>
      )}
      {error && <p className="text-[12.5px] text-red-500">{error}</p>}
      <div className="flex gap-1 rounded-xl bg-raised p-1">
        {FRAMES.map((f) => (
          <button key={f.id} type="button" onClick={() => onFrame(f.id)} className={`flex-1 rounded-lg py-2 text-[12.5px] font-semibold ${run.demo.frame === f.id ? "bg-hover text-text shadow-sm" : "text-muted hover:text-text"}`}>
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
