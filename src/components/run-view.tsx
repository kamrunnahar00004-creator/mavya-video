"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowLeftRight, Check, ChevronDown, Diamond, Download, Eye, Film, FolderOpen, Heart, Link as LinkIcon, Loader2, Music, Pause, Play, Plus, RefreshCw, Scissors, SlidersHorizontal, Smartphone, Smile, Undo2, Volume1, Volume2, VolumeX, Sparkles, Trash2, Type, Upload, X } from "lucide-react";
import { analyzeVideo } from "@/lib/analyze";
import { CHARACTERS, characterById } from "@/lib/characters";
import { FONT_CHOICES, fontCss, fontLabel, loadFonts } from "@/lib/studio-data";
import { ADJUST_ROWS, type Adjust, type AdjustRow, type Motion, NO_ADJUST, fullAdjust, isAdjusted, keyAt, motionAt, moveKey, panBy, setMotion, speedOf, toggleKey, videoStyle } from "@/lib/adjust";
import { audioLength, pieceEnd, refSoundSrc, soundName, soundPieces } from "@/lib/sound";
import type { Song } from "@/app/api/songs/route";
import { type Seg, cutOutTexts, demoClips, retimeTexts, shotList, timeline } from "@/lib/edit";
import { STYLE_GROUPS, STYLE_PRESETS, autoSecond, stylePreset } from "@/lib/text-styles";
import { AVATAR_TONES, TEXT_Y, clipFromAsset, clipFromFile, patchRun, remixHook, round1, runTexts, uid, uploadFile } from "@/lib/client";
import { PLATFORM_LABEL, commentCta, fmtTime, fmtViews, isLikelyBoosted, type Asset, type DemoClip, type Frame, type Reference, type SoundPiece, type Run, type TextLayer, type TextPos } from "@/lib/types";
import { AvatarPlaceholder } from "@/components/frames";
import { LibraryPanel } from "@/components/library-panel";
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
  const [missing, setMissing] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Steps the user opened or closed by hand (undefined = follow progress: just the current step). */
  const [picked, setPicked] = useState<number[] | undefined>(undefined);
  /** Upload: the video is in, waiting for "Use this hook". */
  const [staged, setStaged] = useState<Reference | null>(null);
  const [reading, setReading] = useState(false);
  const [libraryKey, setLibraryKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const runRef = useRef<Run | null>(null);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    let alive = true;
    Promise.all([fetch(`/api/runs/${id}`), fetch("/api/references")])
      .then(async ([r, rs]) => {
        if (!r.ok) throw new Error("missing");
        const runData = (await r.json()) as Run;
        const refData = (await rs.json()) as Reference[];
        if (!alive) return;
        setRun(runData);
        setRefs(refData);
      })
      .catch(() => alive && setMissing(true));
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
      setRun((r) => (r ? { ...r, ...patch, project: null } : r));
      void patchRun(id, { ...patch, project: null });
    },
    [id]
  );

  /** Text edits from the preview: applied live, saved shortly after (coalesced). */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTexts = useCallback((fn: (t: TextLayer[]) => TextLayer[]) => setRun((r) => (r ? { ...r, texts: fn(runTexts(r)) } : r)), []);
  const commitTexts = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
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
        const texts = before === after ? runTexts(r) : retimeTexts(runTexts(r), seg.offset, { start: seg.start, end: seg.end, speed: before }, { start: seg.start, end: seg.end, speed: after });
        const next = clipId === "hook" ? { ...r, hook: { ...r.hook, adjust } } : { ...r, demo: { ...r.demo, clips: demoClips(r).map((c) => (c.id === clipId ? { ...c, adjust } : c)) } };
        return { ...next, texts };
      });
      if (adjustTimer.current) clearTimeout(adjustTimer.current);
      adjustTimer.current = setTimeout(() => {
        const cur = runRef.current;
        if (cur) void patchRun(id, { hook: cur.hook, demo: cur.demo, texts: runTexts(cur), project: null });
      }, 250);
    },
    [id]
  );

  if (missing) {
    return (
      <div className="card flex h-full flex-col items-center justify-center gap-3 text-muted">
        Run not found
        <Link href="/studio" className="font-semibold text-accent">
          Back to runs
        </Link>
      </div>
    );
  }
  if (!run || !refs) {
    return (
      <div className="card flex h-full items-center justify-center text-soft">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const source = refs.find((r) => r.id === run.sourceRefId) ?? null;
  const hook = run.hook;
  const ready = Boolean(hook.generated) && demoClips(run).some((c) => c.mediaId);
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
      title: run.title === "Untitled run" ? ref.title : run.title,
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
  const videoLen = segs.reduce((t, x) => t + x.len, 0);
  const hasDemo = demoClips(run).some((c) => c.mediaId);
  const stepDone = [Boolean(source) || Boolean(hook.source === "describe" && hook.describeReady && hook.describe?.trim()), Boolean(hook.face), Boolean(hook.generated), hasDemo, soundPieces(run, videoLen).length > 0];
  const current = stepDone.findIndex((d) => !d) + 1 || stepDone.length; // 1-based; all done = last step
  // The open step: the user's choice, else the first unfinished one. Finishing a step clears the choice (moves on).
  const openSteps = picked ?? [current];
  const toggleStep = (n: number) => setPicked(openSteps.includes(n) ? openSteps.filter((x) => x !== n) : [...openSteps, n]);
  const faceName = hook.face?.kind === "character" ? characterById(hook.face.id)?.name : hook.face?.kind === "photo" ? "Your photo" : hook.face?.kind === "described" ? hook.face.text : undefined;
  const stepSummary = [
    source?.title ?? (hook.source === "describe" && hook.describeReady ? hook.describe : undefined),
    faceName,
    hook.generated ? "Hook ready" : undefined,
    hasDemo ? (run.demo.mode === "clips" ? `${demoClips(run).filter((c) => c.mediaId).length} clips` : "Demo added") : undefined,
    soundPieces(run, videoLen).length > 1 ? `${soundPieces(run, videoLen).length} sounds` : soundPieces(run, videoLen)[0]?.name,
  ];

  /* ----- Clip editing, shared by the hook and every demo clip ----- */
  const patchText = (tid: string, patch: Partial<TextLayer>) => {
    liveTexts((t) => t.map((x) => (x.id === tid ? { ...x, ...patch } : x)));
    commitTexts();
  };
  const addText = (afterId: string | null, [ws, we]: [number, number], text = "") => {
    liveTexts((t) => {
      const i = afterId ? t.findIndex((x) => x.id === afterId) : -1;
      const base = t[i] ?? t[t.length - 1];
      const item: TextLayer = base
        ? { ...base, id: uid(), text, start: ws, end: we, y: Math.min(90, base.y + 12) }
        : { id: uid(), text, start: ws, end: we, x: 50, y: TEXT_Y.top, size: 4.6, font: "Arial", color: "#ffffff", style: "outline" };
      return i >= 0 ? [...t.slice(0, i + 1), item, ...t.slice(i + 1)] : [...t, item];
    });
    commitTexts();
  };
  const removeText = (tid: string) => {
    liveTexts((t) => t.filter((x) => x.id !== tid));
    commitTexts();
  };
  /** Cut / Undo on one clip: new trim points in its file; texts follow. */
  const trimClip = (clipId: string, start: number, end: number) => {
    const seg = segs.find((x) => x.id === clipId);
    if (!seg) return;
    const speed = speedOf(seg.adjust);
    const nextTexts = retimeTexts(texts, seg.offset, { start: seg.start, end: seg.end, speed }, { start, end, speed });
    if (clipId === "hook") save({ hook: { ...hook, start, end }, texts: nextTexts });
    else save({ demo: { ...run.demo, clips: demoClips(run).map((c) => (c.id === clipId ? { ...c, start, end } : c)) }, texts: nextTexts });
  };
  const clipEditor = (seg: Seg) => (
    <ClipEditor
      key={seg.id}
      seg={seg}
      texts={texts}
      onTrim={(start, end) => trimClip(seg.id, start, end)}
      onAdjust={(a) => liveAdjust(seg.id, a)}
      onPatch={patchText}
      onAdd={addText}
      onRemove={removeText}
    />
  );

  /* ----- Step 4: demo clips ----- */
  /** A text over one clip in the same look and spot as the hook text (off screen by then), so the video keeps one text style. */
  const textOver = (all: TextLayer[], text: string, at: number, len: number): TextLayer => {
    const look = all.find((x) => x.id === "hook") ?? all[0];
    const span = { start: round1(at), end: round1(at + len) };
    return look ? { ...look, id: uid(), text, ...span } : { id: uid(), text, ...span, x: 50, y: TEXT_Y.top, size: 4.6, font: "Arial", color: "#ffffff", style: "outline" };
  };
  /** Puts an uploaded video into a demo clip. Texts after it move later by its length (or by the change, when replacing). */
  const fillClip = async (clipId: string, file: File, startClips?: DemoClip[], mode?: "single" | "clips") => {
    const c = await clipFromFile(file);
    setLibraryKey((k) => k + 1);
    const cur = runRef.current ?? run;
    const seconds = round1(c.length ?? 3);
    const list = startClips ?? demoClips(cur);
    const clips = list.map((x) => (x.id === clipId ? { ...x, mediaId: c.mediaId ?? undefined, name: c.name, seconds, start: 0, end: seconds, adjust: undefined } : x));
    const before = timeline(cur, null);
    const old = before.find((x) => x.id === clipId);
    const placeholder = before.find((x) => x.id === "placeholder");
    const nextRun: Run = { ...cur, demo: { ...cur.demo, mode: mode ?? cur.demo.mode ?? "single", clips } };
    const now = timeline(nextRun, null).find((x) => x.id === clipId);
    let nextTexts = runTexts(cur);
    if (now && placeholder) {
      // First demo video: texts on the "Your demo" placeholder land on it (a text over the whole placeholder covers the whole clip).
      nextTexts = retimeTexts(nextTexts, now.offset, { start: placeholder.start, end: placeholder.end, speed: 1 }, { start: 0, end: now.len, speed: 1 });
    } else if (now) {
      const by = now.len - (old?.len ?? 0);
      nextTexts = nextTexts.map((t) => (t.start >= now.offset - 0.05 ? { ...t, start: round1(t.start + by), end: round1(t.end + by) } : t.end > now.offset + 0.05 && !old ? { ...t, end: round1(t.end + by) } : t));
    }
    // First video for a shot-list clip: its suggested text goes on screen over it, styled like the hook text (editable like any text).
    const suggested = list.find((x) => x.id === clipId)?.text;
    if (now && !old && suggested) nextTexts = [...nextTexts, textOver(nextTexts, suggested, now.offset, now.len)];
    save({ demo: nextRun.demo, texts: nextTexts });
  };
  /** With no demo video left, texts on the demo go back onto the 3s "Your demo" placeholder instead of being lost. */
  const demoToPlaceholder = (from: TextLayer[]) => {
    const demo = segs.filter((x) => x.id !== "hook");
    const at = segs[0].len;
    const len = demo.reduce((a, x) => a + x.len, 0);
    return len ? retimeTexts(from, at, { start: 0, end: len, speed: 1 }, { start: 0, end: 3, speed: 1 }) : from;
  };
  /** "Upload your demo" with one or more videos: one = a single demo, several = clips 1..N in file-name order (IMG_001, IMG_002...). */
  const addVideos = async (files: File[]) => {
    const sorted = [...files].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
    const ups = await Promise.all(sorted.map((f) => clipFromFile(f)));
    setLibraryKey((k) => k + 1);
    const cur = runRef.current ?? run;
    // A single demo turning into clips: "Your demo" becomes "Clip 1".
    const before = demoClips(cur).map((c) => (files.length && c.label === "Your demo" ? { ...c, label: "Clip 1" } : c));
    const added: DemoClip[] = ups.map((c, i) => {
      const seconds = round1(c.length ?? 3);
      return { id: uid(), label: `Clip ${before.length + i + 1}`, mediaId: c.mediaId ?? undefined, name: c.name, seconds, start: 0, end: seconds };
    });
    const clips = [...before, ...added];
    const nextRun: Run = { ...cur, demo: { ...cur.demo, mode: clips.length > 1 ? "clips" : "single", clips } };
    // Texts on the "Your demo" placeholder land on the new videos (new clips go at the end, so nothing else moves).
    const placeholder = timeline(cur, null).find((x) => x.id === "placeholder");
    const demoLen = timeline(nextRun, null).filter((x) => added.some((c) => c.id === x.id)).reduce((t, x) => t + x.len, 0);
    const nextTexts = placeholder ? retimeTexts(runTexts(cur), placeholder.offset, { start: placeholder.start, end: placeholder.end, speed: 1 }, { start: 0, end: demoLen, speed: 1 }) : runTexts(cur);
    save({ demo: nextRun.demo, texts: nextTexts });
  };
  const deleteClip = (clipId: string) => {
    const seg = segs.find((x) => x.id === clipId);
    const clips = demoClips(run).filter((c) => c.id !== clipId);
    const lastVideo = Boolean(seg) && !clips.some((c) => c.mediaId);
    save({ demo: { ...run.demo, clips }, texts: !seg ? texts : lastVideo ? demoToPlaceholder(texts) : cutOutTexts(texts, seg.offset, seg.len) });
  };
  const resetDemo = () => {
    if (hasDemo && !confirm("Remove your demo clips?")) return;
    save({ demo: { ...run.demo, clip: null, mode: undefined, clips: [] }, texts: hasDemo ? demoToPlaceholder(texts) : texts });
  };
  const resetHook = () => save({ sourceRefId: null, hook: { ...hook, source: undefined } });
  /** Applies a change to the hook text item (if the user kept it). */
  const withHookText = (p: Partial<TextLayer>) => texts.map((x) => (x.id === "hook" ? { ...x, ...p } : x));

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <Link href="/studio" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-muted hover:bg-raised hover:text-text">
          <ArrowLeft className="h-4 w-4" />
          Runs
        </Link>
        <TitleInput value={run.title} onSave={(title) => save({ title })} />
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
          className="rounded-lg p-2 text-soft hover:bg-red-500/10 hover:text-red-500"
          aria-label="Delete run"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </header>

      {pickerOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-6" onClick={() => setPickerOpen(false)}>
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

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-h-0 overflow-y-auto">
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
                  <div className="flex items-center gap-3 px-4 py-3 text-[13.5px] text-soft">
                    <button type="button" onClick={() => setPickerOpen(true)} className="btn-primary px-4 py-2.5 text-[14px]">
                      Browse hooks
                    </button>
                    or
                    {(["upload", "describe"] as const).map((m, i) => (
                      <span key={m} className="flex items-center gap-3">
                        {i > 0 && <span aria-hidden>·</span>}
                        <button
                          type="button"
                          aria-pressed={hook.source === m}
                          onClick={() => save({ hook: { ...hook, source: hook.source === m ? undefined : m } })}
                          className={`font-semibold underline-offset-4 hover:underline ${hook.source === m ? "text-accent underline" : "text-muted hover:text-accent"}`}
                        >
                          {m === "upload" ? "Upload a video" : "Describe your own"}
                        </button>
                      </span>
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
                onGenerated={(generated, text) => {
                  // The hook's length changes: texts follow (a text over the whole hook keeps covering it).
                  const sp = speedOf(hook.adjust);
                  const old = segs[0];
                  const moved = retimeTexts(texts, 0, { start: old.start, end: old.end, speed: old.editable ? sp : 1 }, { start: 0, end: generated.seconds, speed: sp });
                  const base = moved.find((x) => x.id === "hook");
                  const end = round1(generated.seconds / sp);
                  const item: TextLayer = base
                    ? { ...base, text: base.text && base.text !== DEFAULT_HOOK_TEXT ? base.text : text }
                    : { id: "hook", text, start: 0, end, x: 50, y: TEXT_Y.top, size: 4.6, font: "Arial", color: "#ffffff", style: "outline" };
                  save({
                    hook: { ...hook, generated, start: 0, end: generated.seconds, text: item.text },
                    texts: [item, ...moved.filter((x) => x.id !== "hook")],
                  });
                }}
                onPatch={patchText}
                onAdd={addText}
                onAdjust={(a) => liveAdjust("hook", a)}
                onTrim={(start, end) => trimClip("hook", start, end)}
                onRemove={removeText}
              />
            </Block>

            <Block n={4} title="Add your demo" done={stepDone[3]} open={openSteps.includes(4)} summary={stepSummary[3]} onToggle={() => toggleStep(4)}>
              <DemoStep
                run={run}
                segs={segs}
                renderEditor={clipEditor}
                onFiles={addVideos}
                onClips={() => save({ demo: { ...run.demo, mode: "clips", clips: shotList(source).map((x) => ({ ...x, id: uid() })) } })}
                onUpload={(cid, f) => fillClip(cid, f)}
                onRename={(cid, label) => save({ demo: { ...run.demo, clips: demoClips(run).map((c) => (c.id === cid ? { ...c, label } : c)) } })}
                onDelete={deleteClip}
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

        <aside className="flex min-h-0 flex-col items-center gap-4 overflow-y-auto border-l border-line bg-raised/50 p-6">
          <RunPreview run={run} source={source} texts={texts} />
          <div className="w-full max-w-[300px]">
            <button type="button" disabled={!ready} onClick={() => setToast("Rendering is not connected yet.")} className="btn-primary w-full py-3 text-[15px]">
              <Download className="h-4 w-4" />
              Export video
            </button>
          </div>
        </aside>
      </div>

      {libraryOpen && (
        <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setLibraryOpen(false)}>
          <div className="absolute bottom-3 right-3 top-3" onClick={(e) => e.stopPropagation()}>
            <LibraryPanel
              open
              onToggle={() => setLibraryOpen(false)}
              refreshKey={libraryKey}
              useLabel={!run.demo.clip ? "Use as demo" : "Replace demo"}
              onUse={async (a: Asset) => {
                if (a.kind === "audio") return;
                save({ demo: { ...run.demo, clip: await clipFromAsset({ ...a, kind: a.kind }) } });
                setLibraryOpen(false);
              }}
            />
          </div>
        </div>
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
      <div className="flex items-center gap-3 px-4 py-3 text-[13.5px] text-soft">
        <button type="button" onClick={() => setBrowsing(true)} className="btn-primary px-4 py-2.5 text-[14px]">
          Browse characters
        </button>
        or
        {(["upload", "describe"] as const).map((m, i) => (
          <span key={m} className="flex items-center gap-3">
            {i > 0 && <span aria-hidden>·</span>}
            <button
              type="button"
              aria-pressed={mode === m}
              onClick={() => onMode(mode === m ? undefined : m)}
              className={`font-semibold underline-offset-4 hover:underline ${mode === m ? "text-accent underline" : "text-muted hover:text-accent"}`}
            >
              {m === "upload" ? "Upload a photo" : "Describe your character"}
            </button>
          </span>
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
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
                  className={`group relative aspect-[3/4] overflow-hidden rounded-xl border-2 transition-[border-color,box-shadow] ${on ? "border-ink shadow-[3px_3px_0_var(--ink)]" : "border-transparent hover:border-ink hover:shadow-[3px_3px_0_var(--ink)]"}`}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6" onClick={(e) => { e.stopPropagation(); setViewing(null); }}>
          <button type="button" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setViewing((viewing - 1 + CHARACTERS.length) % CHARACTERS.length); }} className="absolute left-6 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 text-ink hover:bg-white">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="fade-in flex max-h-full flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown.src} alt={shown.name} className="max-h-[calc(100vh-160px)] rounded-2xl border-2 border-ink object-contain shadow-[6px_6px_0_var(--ink)]" />
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

/** Step 3: the hook clip, in the shared clip editor. Before generating, the video box shows the inputs and a Generate button.
 * Generation is a stand-in (a sample clip) until the Runway API is connected. */
function GenerateStep({ run, source, seg, texts, onGenerated, onPatch, onAdd, onRemove, onTrim, onAdjust }: {
  run: Run;
  source: Reference | null;
  seg: Seg;
  texts: TextLayer[];
  onGenerated: (g: NonNullable<Run["hook"]["generated"]>, text: string) => void;
  onPatch: (id: string, patch: Partial<TextLayer>) => void;
  onAdd: (afterId: string | null, window: [number, number]) => void;
  onRemove: (id: string) => void;
  onTrim: (start: number, end: number) => void;
  onAdjust: (a: Partial<Adjust>) => void;
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
      onTrim={onTrim}
      onAdjust={onAdjust}
      onPatch={onPatch}
      onAdd={onAdd}
      onRemove={onRemove}
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
              className="fade-in absolute inset-x-2 top-11 z-30 rounded-xl border-2 border-ink bg-panel p-2 shadow-[4px_4px_0_var(--ink)]"
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
function ClipEditor({ seg, version, texts, cover, overlay, firstTextPlaceholder = "Text", onTrim, onAdjust, onPatch, onAdd, onRemove }: {
  seg: Seg;
  /** Changes when the clip's file is replaced (reloads the video). */
  version?: string;
  texts: TextLayer[];
  /** Shown instead of the video (e.g. generating, or not generated yet). */
  cover?: React.ReactNode;
  /** Extra controls on top of the video box. */
  overlay?: React.ReactNode;
  firstTextPlaceholder?: string;
  onTrim: (start: number, end: number) => void;
  onAdjust: (a: Partial<Adjust>) => void;
  onPatch: (id: string, patch: Partial<TextLayer>) => void;
  onAdd: (afterId: string | null, window: [number, number]) => void;
  onRemove: (id: string) => void;
}) {
  const live = Boolean(seg.src && seg.editable && !cover);
  const panned = useRef(false);
  const [full, setFull] = useState(false);
  // Player times are relative to the clip's start (0 = first kept frame), in on-screen seconds.
  const base = seg.start;
  const fileLen = Math.max(0.5, seg.end - seg.start);
  const speed = speedOf(seg.adjust);
  const len = seg.len;
  const offset = seg.offset;
  const [sel, setSel] = useState<[number, number] | null>(null); // pending trim, until "Cut"
  const [undo, setUndo] = useState<[number, number][]>([]); // earlier cuts, newest last
  const [prevSpeed, setPrevSpeed] = useState(speed);
  if (prevSpeed !== speed) {
    setPrevSpeed(speed);
    setSel(null);
  }
  const [r0, r1] = sel ?? [0, len];
  const vref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);
  const seek = useCallback((rel: number) => {
    const v = vref.current;
    if (v) v.currentTime = base + rel * speed;
    setT(rel);
  }, [base, speed]);
  // Keep playback inside the kept range, loop it, and move the playhead smoothly.
  useEffect(() => {
    const v = vref.current;
    if (!v || !playing || !live) return;
    v.playbackRate = speed;
    void v.play().catch(() => undefined);
    let raf = 0;
    const frame = () => {
      const rel = (v.currentTime - base) / speed;
      if (rel >= r1 - 0.02 || rel < r0 - 0.05 || v.ended) {
        v.currentTime = base + r0 * speed;
        void v.play().catch(() => undefined);
      }
      setT(Math.max(0, Math.min(len, (v.currentTime - base) / speed)));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, live, base, len, speed, r0, r1, version]);
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
  const fileT = base + t * speed;
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
    <div className="space-y-3">
      <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-4">
        <div className="space-y-2">
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
                  onKeyDown={(e) => e.key === "Enter" && setFull(true)}
                  aria-label="Play full screen"
                  title={zoomed ? "Drag to move the picture" : undefined}
                  className={`absolute inset-0 overflow-hidden ${zoomed ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-zoom-in"}`}
                >
                  <WarmthFilter adjust={seg.adjust} />
                  <video ref={vref} key={`${seg.src}|${version ?? ""}`} src={seg.src} muted playsInline onLoadedMetadata={() => seek(r0)} className="absolute inset-0 h-full w-full object-cover" style={look} />
                  {local.filter((x) => x.text.trim() && t >= x.start - 0.05 && t <= x.end + 0.05).map((x) => <TextOverlay key={x.id} x={x} onMove={(pos) => onPatch(x.id, pos)} />)}
                </div>
              ) : null)}
            {overlay}
          </div>

          {live && (
            <ClipControls
              label={seg.label}
              playing={playing}
              onPlay={() => setPlaying((x) => !x)}
              t={t}
              len={len}
              range={[r0, r1]}
              onRange={(v, edge) => {
                setSel(v);
                setPlaying(false);
                seek(edge);
              }}
              onSeek={(rel) => {
                setPlaying(false);
                seek(rel);
              }}
              onCut={() => {
                setUndo((u) => [...u, [base, base + fileLen]]);
                onTrim(round1(base + r0 * speed), round1(base + r1 * speed));
                setSel(null);
                setT(0);
              }}
              texts={local}
              onTiming={(tid, patch) =>
                // No 0.1s rounding here: a snapped edge must land exactly on the clip's start / end.
                onPatch(tid, {
                  ...(patch.start !== undefined ? { start: Math.round((patch.start + offset) * 1000) / 1000 } : {}),
                  ...(patch.end !== undefined ? { end: Math.round((patch.end + offset) * 1000) / 1000 } : {}),
                })
              }
              keys={allKeys.map((k, i) => ({ i, at: (k.t - base) / speed })).filter((k) => k.at >= -0.01 && k.at <= len + 0.01)}
              onKeyMove={(i, rel) => onAdjust(moveKey(seg.adjust, i, base + Math.max(0, Math.min(len, rel)) * speed))}
              canUndo={undo.length > 0}
              onUndo={() => {
                const last = undo[undo.length - 1];
                if (!last) return;
                setUndo((u) => u.slice(0, -1));
                onTrim(last[0], last[1]);
                setSel(null);
                setT(0);
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
            <TextRow key={x.id} t={x} placeholder={i === 0 ? firstTextPlaceholder : "More text"} onPatch={(patch) => onPatch(x.id, patch)} onAdd={() => onAdd(x.id, span)} onRemove={() => onRemove(x.id)} />
          ))}
        </div>
      ) : (
        <button type="button" onClick={() => onAdd(null, span)} className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong py-3 text-[13.5px] font-semibold text-muted hover:border-accent hover:text-accent">
          <Plus className="h-4 w-4" />
          Add text
        </button>
      )}

      {full && live && seg.src && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-6" onClick={() => setFull(false)}>
          <div className="fade-in relative aspect-[9/16] h-[min(86vh,900px)] overflow-hidden rounded-2xl border-2 border-ink bg-black shadow-[6px_6px_0_var(--ink)] [container-type:size]" onClick={(e) => e.stopPropagation()}>
            <WarmthFilter adjust={seg.adjust} />
            <TrimmedVideo src={seg.src} start={base} end={base + fileLen} rate={speed} adjust={seg.adjust} />
            {local.filter((x) => x.text.trim()).map((x) => <TextOverlay key={x.id} x={x} onMove={(pos) => onPatch(x.id, pos)} />)}
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
function WholePlayer({ segs, texts, pieces, selected, side, onSelect, onTrim, onMove, onSplit, onAdd, onDelete, onUndo, onRedo }: {
  segs: Seg[];
  /** Shown next to the video (the selected sound's card). */
  side: React.ReactNode;
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
  const total = Math.max(0.5, segs.reduce((a, x) => a + x.len, 0));
  const [t, setT] = useState(0);
  // Starts paused; pressing play here pauses the phone preview (one sound at a time).
  const [playing, setPlaying] = useState(false);
  usePlaybackClaims("whole", setPlaying);
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
  const seg = segs.find((x) => time >= x.offset && time < x.offset + x.len) ?? segs[segs.length - 1];
  const speed = seg.editable ? speedOf(seg.adjust) : 1;
  const at = seg.start + (time - seg.offset) * speed;

  // Keyboard, like CapCut: Space play/pause, Delete removes the selected sound, S / Ctrl+B split, Ctrl+Z undo, Ctrl+Shift+Z redo, arrows move the playhead, Esc deselects.
  const keys = useRef({ time, playing, onSplit, onDelete, onUndo, onRedo, onSelect });
  useEffect(() => {
    keys.current = { time, playing, onSplit, onDelete, onUndo, onRedo, onSelect };
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = keys.current;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === "Space") {
        if (!k.playing) claimPlayback("whole");
        setPlaying(!k.playing);
      } else if (e.key === "Delete" || e.key === "Backspace") k.onDelete();
      else if ((!mod && e.key.toLowerCase() === "s") || (mod && e.key.toLowerCase() === "b")) {
        setPlaying(false);
        k.onSplit(k.time);
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
  }, [total]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-4">
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-line bg-[#14121f] [container-type:size]">
        {seg.src ? (
          <>
            <WarmthFilter adjust={seg.editable ? seg.adjust : null} />
            <SyncedVideo key={`${seg.id}|${seg.src}`} src={seg.src} at={at} playing={playing} rate={speed} volume={seg.editable ? fullAdjust(seg.adjust).volume / 100 : 0} style={seg.editable ? videoStyle(seg.adjust, at) : undefined} />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold text-white/40">{seg.id === "hook" ? "Your hook" : "Your demo"}</div>
        )}
        {texts.filter((x) => x.text.trim() && time >= x.start && time < x.end).map((x) => <TextOverlay key={x.id} x={x} />)}
      </div>
      <div className="min-w-0">{side}</div>
      </div>
      {pieces.map((p, i) => (
        <SyncedAudio key={p.id} src={p.src} at={soundAt({ ...p, end: pieceEnd(pieces, i, total) }, time)} playing={playing} volume={p.volume / 100} />
      ))}
      <WholeControls
        segs={segs}
        texts={texts}
        pieces={pieces}
        selected={selected}
        total={total}
        t={time}
        playing={playing}
        onPlay={() => {
          if (!playing) claimPlayback("whole");
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
    </div>
  );
}

/** Player bar for the whole video, three lines like CapCut: the clips, the texts, the sound line (click a sound, ✂ split it, drag its ends to trim, + add another). */
function WholeControls({ segs, texts, pieces, selected, total, t, playing, onPlay, onSeek, onSelect, onTrim, onMove, onSplit, onAdd }: {
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
  const pct = (v: number) => `${(Math.max(0, Math.min(total, v)) / total) * 100}%`;
  // A sound being trimmed follows the pointer; it is saved once, on release.
  const [draft, setDraft] = useState<{ id: string; at: number; end: number } | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const span = (p: SoundPiece, i: number): [number, number] => (draft?.id === p.id ? [draft.at, draft.end] : [p.at, pieceEnd(pieces, i, total)]);
  const underPlayhead = pieces.find((p, i) => t > p.at + 0.25 && t < pieceEnd(pieces, i, total) - 0.25);

  function seek(e: React.PointerEvent) {
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    const at = (x: number) => ((x - rect.left) / rect.width) * total;
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
    const lo = i > 0 ? pieceEnd(pieces, i - 1, total) : 0;
    const hi = i + 1 < pieces.length ? pieces[i + 1].at : total;
    const tol = (12 / rect.width) * total;
    const points = [0, total, t, lo, hi, ...segs.map((x) => x.offset)];
    const snap = (v: number) => points.reduce<number | null>((best, q) => (Math.abs(q - v) <= tol && (best === null || Math.abs(q - v) < Math.abs(best - v)) ? q : best), null);
    const sx = e.clientX;
    let moved = false;
    let next: [number, number] = [a0, b0];
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return;
      moved = true;
      const raw = a0 + ((ev.clientX - sx) / rect.width) * total;
      const sa = snap(raw);
      const sb = snap(raw + size);
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
    const lo = i > 0 ? pieceEnd(pieces, i - 1, total) : 0;
    const hi = i + 1 < pieces.length ? pieces[i + 1].at : total;
    const tol = (12 / rect.width) * total;
    // Magnet: clip edges, the playhead, the start / end, and the neighbouring sounds' edges (so they connect).
    const points = [0, total, t, lo, hi, ...segs.map((x) => x.offset)];
    const sx = e.clientX;
    let next: [number, number] = [a0, b0];
    const move = (ev: PointerEvent) => {
      const raw = (edge === "left" ? a0 : b0) + ((ev.clientX - sx) / rect.width) * total;
      const snapped = points.reduce<number | null>((best, q) => (Math.abs(q - raw) <= tol && (best === null || Math.abs(q - raw) < Math.abs(best - raw)) ? q : best), null);
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
        <span className="whitespace-nowrap font-mono text-[11.5px] tabular-nums text-muted">
          {clock(t)} / {clock(total)}
        </span>
        <div className="ml-auto flex items-center">
          <button type="button" disabled={!underPlayhead} onClick={onSplit} title="Split the sound at the playhead (S)" className="flex items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[12px] font-bold text-text hover:bg-raised hover:text-accent disabled:text-soft disabled:hover:bg-transparent">
            <Scissors className="h-3.5 w-3.5" />
            Split
          </button>
          <button type="button" onClick={onAdd} title="Add a sound at the playhead" className="flex items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[12px] font-bold text-text hover:bg-raised hover:text-accent">
            <Plus className="h-3.5 w-3.5" />
            Sound
          </button>
        </div>
      </div>
      <div ref={area} className="relative select-none">
        <div className="relative h-4 cursor-pointer" onPointerDown={seek}>
          {Array.from({ length: Math.floor(total) + 1 }, (_, s) => (
            <span key={s} className="absolute top-0 h-1.5 w-px bg-line" style={{ left: pct(s) }} />
          ))}
        </div>
        {/* 1. the clips */}
        <div className="flex h-7 cursor-pointer overflow-hidden rounded-md text-[10.5px] font-bold" onPointerDown={seek}>
          {segs.map((x, i) => (
            <div
              key={x.id}
              title={x.label}
              className={`flex min-w-0 items-center border-white px-1.5 ${i ? "border-l-2" : ""} ${x.id === "hook" ? "bg-accent text-accent-ink" : !x.src ? "bg-hover text-soft" : i % 2 ? "bg-[#dcdcea] text-text" : "bg-[#cfcfe2] text-text"}`}
              style={{ width: pct(x.len) }}
            >
              <span className="truncate">{x.id === "hook" ? "Hook" : x.src ? x.label : "Demo"}</span>
            </div>
          ))}
        </div>
        {/* 2. the texts */}
        {texts.length > 0 && (
          <div className="mt-1 space-y-1">
            {texts.map((x) => (
              <div key={x.id} className="relative h-5 cursor-pointer rounded-md bg-raised/70" onPointerDown={seek}>
                <div className="absolute inset-y-0 flex items-center gap-1 overflow-hidden rounded-md bg-accent-tint px-1.5 text-[10px] font-semibold text-accent" style={{ left: pct(x.start), width: `calc(${pct(x.end)} - ${pct(x.start)})` }}>
                  <Type className="h-3 w-3 shrink-0" />
                  <span className="truncate">{x.text}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* 3. the sound line */}
        <div
          className="relative mt-1 h-9 cursor-pointer rounded-md bg-raised/70"
          onPointerDown={(e) => {
            onSelect(null);
            seek(e);
          }}
        >
          {pieces.length === 0 && <span className="absolute inset-0 flex items-center px-2 text-[10.5px] font-semibold text-soft">No sound yet</span>}
          {pieces.map((p, i) => {
            const [a, b] = span(p, i);
            const on = p.id === selected;
            // Touching the sound before / after: square corners there, so the two read as one connected strip.
            const joinL = i > 0 && Math.abs(span(pieces[i - 1], i - 1)[1] - a) < 0.01;
            const joinR = i + 1 < pieces.length && Math.abs(span(pieces[i + 1], i + 1)[0] - b) < 0.01;
            const handle = "absolute inset-y-0 z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-ink";
            return (
              <div
                key={p.id}
                role="button"
                aria-label={`Sound: ${p.name}`}
                aria-pressed={on}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(p.id);
                  moveSound(e, i);
                }}
                className={`absolute inset-y-0 flex cursor-grab touch-none items-center gap-1.5 overflow-hidden rounded-md px-4 text-[10.5px] font-bold active:cursor-grabbing ${joinL ? "rounded-l-none" : ""} ${joinR ? "rounded-r-none border-r border-white" : ""} ${on ? "bg-accent text-accent-ink" : "bg-accent-tint text-accent hover:bg-[#e2d8ff]"}`}
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
        <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-0.5 rounded bg-text" style={{ left: pct(t) }} />
        {guide !== null && <div className="pointer-events-none absolute -bottom-1 -top-1 z-30 w-px -translate-x-1/2 bg-accent" style={{ left: pct(guide) }} />}
      </div>
    </div>
  );
}

/**
 * Step 5: the sound line, like CapCut's audio track. The first sound covers the whole video.
 * ✂ Split cuts a sound at the playhead, + Add sound puts another one in at the playhead, 🗑 leaves that stretch
 * to the video's own sound. Each sound: the hook's own sound, a real song, or the user's file.
 */
function SoundStep({ run, source, segs, texts, videoLen, onPieces }: {
  run: Run;
  source: Reference | null;
  segs: Seg[];
  texts: TextLayer[];
  videoLen: number;
  onPieces: (pieces: SoundPiece[]) => void;
}) {
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
      // A new sound: the first covers the whole video; later ones fill [at, end], cutting a sound they start inside.
      const span = adding ?? { at: 0, end: videoLen };
      const piece: SoundPiece = { id: uid(), volume: 100, ...sound, at: span.at, end: span.end };
      put([...pieces.map((p, i) => (p.at < span.at && pieceEnd(pieces, i, videoLen) > span.at ? { ...p, end: span.at } : p)), piece]);
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
    const i = pieces.findIndex((p, j) => t > p.at + 0.25 && t < pieceEnd(pieces, j, videoLen) - 0.25);
    if (i < 0) return;
    const p = pieces[i];
    const at = Math.round(t * 1000) / 1000;
    const second: SoundPiece = { ...p, id: uid(), at, end: pieceEnd(pieces, i, videoLen), start: round1(p.start + (at - p.at)) };
    put([...pieces.filter((x) => x.id !== p.id), { ...p, end: at }, second]);
    setSelId(second.id);
  }

  /** + Add sound at the playhead: fills until the next sound (or the end); the chooser opens. */
  function addAt(t: number) {
    const at = Math.round(Math.min(t, videoLen - 0.5) * 1000) / 1000;
    const next = pieces.find((p) => p.at > at + 0.05);
    const end = next ? next.at : videoLen;
    if (end - at < 0.5) return;
    setAdding({ at, end });
    setChanging(false);
    setSelId(null);
  }

  /** Trimming a sound's start keeps its audio in place (the cut just hides the beginning), like CapCut. */
  function trimPiece(id: string, at: number, end: number) {
    put(pieces.map((p) => (p.id === id ? { ...p, start: Math.max(0, round1(p.start + (at - p.at))), at, end } : p)));
  }

  const chooser = (
    <div className="rounded-2xl border border-line bg-panel">
      {(adding || changing) && (
        <div className="px-4 pt-3 text-[13px] font-semibold text-soft">
          {adding ? `New sound from ${fmtTime(adding.at)} to ${fmtTime(adding.end)}` : `Change "${sel?.name ?? "sound"}"`}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13.5px] text-soft">
        {hookSrc ? (
          <>
            <button type="button" disabled={Boolean(busy)} onClick={() => source && void pick("hook", hookSrc, soundName(source), source.id)} className="btn-primary px-4 py-2.5 text-[14px] disabled:opacity-60">
              {busy === "hook" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Use the hook's sound"}
            </button>
            or
            <button type="button" onClick={() => setBrowsing(true)} className="font-semibold text-muted underline-offset-4 hover:text-accent hover:underline">
              Browse songs
            </button>
            <span aria-hidden>·</span>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setBrowsing(true)} className="btn-primary px-4 py-2.5 text-[14px]">
              Browse songs
            </button>
            or
          </>
        )}
        <label className={`cursor-pointer font-semibold text-muted underline-offset-4 hover:text-accent hover:underline ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy === "upload" ? "Uploading..." : "Upload your own"}
          <input type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => void upload(e.target.files?.[0]).then(() => (e.target.value = ""))} />
        </label>
        {(adding || changing) && (
          <button
            type="button"
            onClick={() => {
              setAdding(null);
              setChanging(false);
            }}
            className="ml-auto rounded-lg px-2 py-1.5 text-[13px] font-semibold text-soft hover:text-text"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="border-t border-line px-4 py-2.5 text-[13px] font-semibold text-red-600">{error}</p>}
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
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
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

  return (
    <WholePlayer
      segs={segs}
      texts={texts}
      pieces={pieces}
      selected={sel?.id ?? null}
      onSelect={(id) => {
        setSelId(id);
        setChanging(false);
        setAdding(null);
      }}
      onTrim={trimPiece}
      onMove={(id, at, end) => put(pieces.map((p) => (p.id === id ? { ...p, at, end } : p)))}
      onSplit={split}
      onAdd={addAt}
      onDelete={deleteSelected}
      onUndo={undo}
      onRedo={redo}
      side={panel}
    />
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
        const buf = await (await fetch(src)).arrayBuffer();
        const ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(buf);
        void ctx.close();
        const data = audio.getChannelData(0);
        const step = Math.floor(data.length / BARS);
        const out: number[] = [];
        for (let i = 0; i < BARS; i++) {
          let sum = 0;
          for (let j = i * step; j < (i + 1) * step; j += 16) sum += Math.abs(data[j]);
          out.push(sum / (step / 16));
        }
        const max = Math.max(...out, 0.0001);
        if (alive) setPeaks(out.map((v) => 0.15 + 0.85 * (v / max)));
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
        onPointerDown={drag}
        title={movable ? "Drag to choose which part plays" : undefined}
        className={`relative flex h-14 touch-none select-none items-center gap-[2px] ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {(peaks ?? Array.from({ length: BARS }, () => 0.2)).map((h, i) => (
          <span key={i} className={`flex-1 rounded-full ${inWin(i) ? "bg-accent" : "bg-accent/20"}`} style={{ height: `${h * 100}%` }} />
        ))}
        {/* the part that plays */}
        <span className="pointer-events-none absolute inset-y-0 rounded-lg border-2 border-accent" style={{ left: `${(from / total) * 100}%`, width: `${(win / total) * 100}%` }} />
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
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
function DemoStep({ run, segs, renderEditor, onFiles, onClips, onUpload, onRename, onDelete, onReset }: {
  run: Run;
  segs: Seg[];
  renderEditor: (seg: Seg) => React.ReactNode;
  /** One video = one demo; several = clips in file-name order. */
  onFiles: (files: File[]) => Promise<void>;
  onClips: () => void;
  onUpload: (id: string, f: File) => Promise<void>;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
}) {
  const clips = demoClips(run);
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
        <div className="flex items-center gap-3 px-4 py-3 text-[13.5px] text-soft">
          <label className={`btn-primary cursor-pointer px-4 py-2.5 text-[14px] ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy === "single" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upload your demo"}
            <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => void takeMany(e.target.files).then(() => (e.target.value = ""))} />
          </label>
          or
          <button type="button" onClick={onClips} className="font-semibold text-muted underline-offset-4 hover:text-accent hover:underline">
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
          <div key={c.id} className={`rounded-2xl border bg-panel ${open ? "border-line-strong" : "border-line"}`}>
            <div className="flex items-center gap-4 px-4 py-3.5">
              {c.mediaId ? (
                <button type="button" onClick={() => setOpenId(open ? null : c.id)} aria-label={open ? "Close clip" : "Edit clip"} className="relative shrink-0">
                  <video src={`/api/media/${c.mediaId}#t=0.5`} muted preload="metadata" className="h-[56px] w-[32px] rounded-md bg-ink object-cover" />
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
              {c.mediaId ? (
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
function AdvancedSettings({ value, disabled, onChange, motion, keyOn, onMotion, onKey }: {
  value?: Partial<Adjust>;
  disabled: boolean;
  onChange: (a: Partial<Adjust>) => void;
  /** Zoom / position at the playhead (keyframes applied). */
  motion: Motion;
  keyOn: boolean;
  onMotion: (p: Partial<Motion>) => void;
  onKey: () => void;
}) {
  const [open, setOpen] = useState(false);
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
                      className={`w-14 rounded-lg border border-line bg-raised py-1 text-center font-mono text-[12.5px] tabular-nums outline-none focus:border-accent ${r.key === "speed" ? "pl-1 pr-3.5" : "px-2"}`}
                    />
                    {r.key === "speed" && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[12px] text-soft">x</span>}
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
function TextRow({ t, placeholder, onPatch, onAdd, onRemove }: { t: TextLayer; placeholder: string; onPatch: (p: Partial<TextLayer>) => void; onAdd: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
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
        </div>
      )}
    </div>
  );
}

/** A clip that plays only between start and end (seconds), looping. */
function TrimmedVideo({ src, start, end, muted = false, adjust, rate = 1 }: { src: string; start: number; end: number; muted?: boolean; adjust?: Partial<Adjust>; rate?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const style = videoStyle(adjust, start);
  // Keyframed zoom / position: follow the video's own clock.
  useEffect(() => {
    if (!fullAdjust(adjust).keys.length) return;
    let raf = 0;
    const frame = () => {
      const v = ref.current;
      if (v) v.style.transform = videoStyle(adjust, v.currentTime)?.transform ?? "";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [adjust]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.playbackRate = rate;
    if (v.currentTime < start || v.currentTime > end) v.currentTime = start;
    void v.play().catch(() => undefined);
    const tick = () => {
      if (v.currentTime >= end || v.currentTime < start) v.currentTime = start;
    };
    v.addEventListener("timeupdate", tick);
    return () => v.removeEventListener("timeupdate", tick);
  }, [start, end, rate]);
  return <video ref={ref} src={src} autoPlay muted={muted} loop playsInline className="absolute inset-0 h-full w-full object-cover" style={style} />;
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;

/** Player bar under the generated hook, styled like the preview strip: play/pause, time, ruler,
 *  the clip with drag handles on both ends, a playhead, Cut (removes what is outside) and Undo. */
function ClipControls({ label, playing, onPlay, t, len, range, onRange, onSeek, onCut, texts, onTiming, keys, onKeyMove, canUndo, onUndo }: {
  label: string;
  playing: boolean;
  onPlay: () => void;
  t: number;
  len: number;
  range: [number, number];
  onRange: (v: [number, number], edge: number) => void;
  onSeek: (t: number) => void;
  onCut: () => void;
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
  const [a, b] = range;
  const pct = (v: number) => `${(v / len) * 100}%`;
  const trimmed = a > 0.05 || b < len - 0.05;
  function track(e: React.PointerEvent, on: (sec: number) => void) {
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
    e.preventDefault();
    e.stopPropagation();
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX;
    const { start, end } = x;
    const size = end - start;
    // Snap (like CapCut) to the clip's start and end, the playhead, and other texts' edges, within 8px.
    const tol = (12 / rect.width) * len;
    const points = [0, len, t, ...texts.filter((o) => o.id !== x.id).flatMap((o) => [o.start, o.end])];
    const snap = (v: number) => points.reduce<number | null>((best, p) => (Math.abs(p - v) <= tol && (best === null || Math.abs(p - v) < Math.abs(best - v)) ? p : best), null);
    const move = (ev: PointerEvent) => {
      const d = ((ev.clientX - sx) / rect.width) * len;
      if (mode === "move") {
        const raw = start + d;
        const a = snap(raw);
        const b = snap(raw + size);
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
  return (
    <div className="w-full rounded-2xl border border-line bg-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={onPlay} className="btn-primary h-7 w-7 rounded-full p-0" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />}
        </button>
        <span className="font-mono text-[11.5px] tabular-nums text-muted">
          {clock(t)} / {clock(len)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {canUndo && (
            <button type="button" onClick={onUndo} title="Undo cut" aria-label="Undo cut" className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-text">
              <Undo2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            disabled={!trimmed}
            onClick={onCut}
            title="Drag the ends of the clip, then cut"
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
          {/* kept part */}
          <div className="absolute inset-y-0 flex items-center bg-accent px-4 text-[10.5px] font-bold text-accent-ink" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }}>
            <span className="truncate">{label}</span>
          </div>
          {keys.map((k) => (
            <span
              key={k.i}
              role="button"
              aria-label={`Keyframe at ${k.at.toFixed(1)}s`}
              title="Click to jump, drag to move"
              onPointerDown={(e) => dragKey(e, k)}
              className={`absolute top-1/2 z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-pointer touch-none rounded-[2px] border-[1.5px] border-ink ${Math.abs(k.at - t) < 0.06 ? "bg-ink" : "bg-white"}`}
              style={{ left: pct(k.at) }}
            />
          ))}
          <span
            role="slider"
            aria-label="Trim start"
            aria-valuemin={0}
            aria-valuemax={len}
            aria-valuenow={a}
            onPointerDown={(e) => track(e, (v) => { const x = round1(Math.min(v, b - 0.5)); onRange([x, b], x); })}
            className={`${handle} rounded-l-md`}
            style={{ left: pct(a) }}
          >
            <span className="h-3.5 w-0.5 rounded-full bg-white" />
          </span>
          <span
            role="slider"
            aria-label="Trim end"
            aria-valuemin={0}
            aria-valuemax={len}
            aria-valuenow={b}
            onPointerDown={(e) => track(e, (v) => { const x = round1(Math.max(v, a + 0.5)); onRange([a, x], x); })}
            className={`${handle} -translate-x-full rounded-r-md`}
            style={{ left: pct(b) }}
          >
            <span className="h-3.5 w-0.5 rounded-full bg-white" />
          </span>
        </div>
        {texts.length > 0 && (
          <div className="mt-1 space-y-1">
            {texts.map((x, i) => (
              <div key={x.id} className="relative h-6 rounded-md bg-raised/70" onPointerDown={(e) => track(e, onSeek)}>
                <div
                  onPointerDown={(e) => dragText(e, x, "move")}
                  title="Drag to move. Drag the ends to make it longer or shorter."
                  className={`group absolute inset-y-0 flex cursor-grab touch-none items-center gap-1 overflow-hidden rounded-md bg-accent-tint px-3.5 text-[10.5px] font-semibold text-accent active:cursor-grabbing ${x.start <= 0.05 && x.end >= len - 0.05 ? "ring-1 ring-inset ring-accent" : ""}`}
                  style={{ left: pct(Math.min(x.start, len)), width: pct(Math.max(0, Math.min(x.end, len) - Math.min(x.start, len))) }}
                >
                  <Type className="h-3 w-3 shrink-0" />
                  <span className="truncate">{x.text.trim() || (i === 0 ? "Hook text" : "More text")}</span>
                  {/* Clear end caps (purple, unlike the clip trimmer's black ones) so the start and end are easy to grab and to line up. */}
                  <span aria-label="Text start" onPointerDown={(e) => dragText(e, x, "left")} className="absolute inset-y-0 left-0 flex w-2.5 cursor-ew-resize touch-none items-center justify-center rounded-l-md bg-accent">
                    <span className="h-2.5 w-px rounded-full bg-white" />
                  </span>
                  <span aria-label="Text end" onPointerDown={(e) => dragText(e, x, "right")} className="absolute inset-y-0 right-0 flex w-2.5 cursor-ew-resize touch-none items-center justify-center rounded-r-md bg-accent">
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
          <span className="font-mono text-[12px] tabular-nums text-white/80">{clock}</span>
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
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${done ? "bg-emerald-500 text-white" : open ? "bg-accent-tint text-accent" : "bg-raised text-soft"}`}>
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
      className="group relative aspect-[9/16] overflow-hidden rounded-xl border-2 border-transparent bg-ink text-left transition-[border-color,box-shadow] hover:border-ink hover:shadow-[4px_4px_0_var(--ink)] disabled:opacity-60"
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
        <span className="rounded-md border-2 border-ink bg-white px-2 py-0.5 text-[11.5px] font-bold text-ink">{busy ? "Loading..." : !r.mediaId && embedUrl(r) ? "Preview" : "Use this hook"}</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={onClose}>
      <div className="fade-in flex max-h-[94vh] w-full max-w-[880px] overflow-hidden rounded-2xl border-2 border-ink bg-panel shadow-[6px_6px_0_var(--ink)]" onClick={(e) => e.stopPropagation()}>
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
      <div className="mt-1 flex justify-between font-mono text-[11.5px] text-muted">
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
