"use client";
import { RouteSkeleton } from "@/components/route-skeleton";
import { MediaVideo } from "@/components/media-video";

import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "@/components/pending-link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronDown, Film, FolderOpen, Loader2, PenLine, RefreshCw, SlidersHorizontal, Sparkles, Trash2, Upload, X } from "lucide-react";


import { analyzeVideo } from "@/lib/analyze";
import { CHARACTERS, characterById } from "@/lib/characters";
import { DEFAULT_FONT } from "@/lib/studio-data";
import { type Adjust, speedOf } from "@/lib/adjust";
import { soundPieces } from "@/lib/sound";

import { type Seg, clipSrc, demoClips, moveClipPiece, removeDemoClip, videoLength, pieceSpans, remapTexts, retimeTexts, runSteps, shotList, storeParts, timeline } from "@/lib/edit";

import { AVATAR_TONES, TEXT_Y, clipFromFile, saveStateOf, saveErrorOf, subscribeSaves, flushRunSaves, waitRunSaves, patchRun, remixHook, round1, runTexts, uid, uploadFile } from "@/lib/client";
import { fmtTime, type DemoClip, type Frame, type Part, type Reference, type Run, type TextLayer, type TextPos } from "@/lib/types";
import { AvatarPlaceholder } from "@/components/frames";
import { ExportButton } from "@/components/export-button";
import { pollDelay, waitForPoll } from "@/lib/polling";
import dynamic from "next/dynamic";
import { SourcePicker, UploadDrop, Thumb } from "@/components/source-picker";
import { libraryMore, loadLibrary } from "@/lib/library-cache";
const HistoryPanel = dynamic(() => import("@/components/history-panel").then(m => m.HistoryPanel));
import { ProductStep, newHookLines, readProduct, writeScript } from "@/components/product-step";
import { RunPreview, claimPlayback } from "@/components/run-preview";

const ClipEditor = dynamic(() => import("@/components/editor-tools").then(m => m.ClipEditor));
const SoundStep = dynamic(() => import("@/components/editor-tools").then(m => m.SoundStep));
const VideoEditor = dynamic(() => import("@/components/editor-tools").then(m => m.VideoEditor), { loading: () => <div role="dialog" aria-label="Opening editor" className="fixed inset-0 z-50 bg-panel p-6"><RouteSkeleton path="/studio/loading/edit" /></div> });
const DemoStep = dynamic(() => import("@/components/editor-tools").then(m => m.DemoStep));
const GenerateProgress = dynamic(() => import("@/components/editor-tools").then(m => m.GenerateProgress));
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
  const [refCursor, setRefCursor] = useState<string | null>(null);
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Steps the user opened or closed by hand (undefined = follow progress: just the current step). */
  const [picked, setPicked] = useState<number[] | undefined>(undefined);
  /** The run whose step 1 the seller left (opened step 2). */
  const [productOk, setProductOk] = useState<string | null>(null);
  /** Upload: the video is in, waiting for "Use this hook". */
  const [staged, setStaged] = useState<Reference | null>(null);
  const [reading, setReading] = useState(false);
  const [libraryKey, setLibraryKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  /** The full editor (Edit under the phone) is open. */
  const [editing, setEditing] = useState(false);
  const runRef = useRef<Run | null>(null);
  const deleting = useRef(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  /** Step 1 reads the site in the background: the link being read, or the one that failed (with its error). */
  const [productJob, setProductJob] = useState<{ runId: string; url: string; error?: string } | null>(null);
  /** The demo plan (script) being written, started by the Generate click. */
  const [planning, setPlanning] = useState<string | null>(null);
  /** Generate was clicked: write the demo plan as soon as the product brief is in. */
  const wantPlan = useRef<string | null>(null);
  const liveId = useRef(id);

  useEffect(() => {
    runRef.current = run;
  }, [run]);
  useEffect(() => {
    liveId.current = id;
  }, [id]);
  // Steps 4 to 6 and the editor share one code chunk; fetch it while the seller is on the early steps, so opening
  // one never shows an empty step while it downloads.
  useEffect(() => {
    const timer = setTimeout(() => void import("@/components/editor-tools").catch(() => undefined), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    // The video is usable independently of the full catalog. Library failures do not hide it.
    void loadLibrary().then(page => {
      if (!alive) return;
      setRefs(old => [...(old ?? []).filter(r => !r.partial), ...page.items.filter(r => !(old ?? []).some(x => !x.partial && x.id === r.id))]);
      setRefCursor(page.next);
    }).catch(() => { if (alive) { setRefs(old => old ?? []); setToast("Library is unavailable. Try again."); } });
    void fetch(`/api/runs/${id}`).then(async response => {
      if (!response.ok) throw Error("missing");
      const data = await response.json() as Run;
      if (!alive) return;
      if (data.sourceRefId) {
        const selected = await fetch(`/api/references/${data.sourceRefId}`, { cache: "no-store" });
        if (!selected.ok) throw Error("source");
        const full = await selected.json() as Reference;
        if (alive) setRefs(old => [full, ...(old ?? []).filter(r => r.id !== full.id)]);
      } else setRefs(old => old ?? []);
      if (alive) setRun(data);
    }).catch(() => alive && setMissing(id));
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
  /** The product brief and the script are written on the server (Gemini); take only those two sections back. */
  const takeAI = useCallback((u: Pick<Run, "product" | "script">) => setRun((r) => (r?.id === id ? { ...r, product: u.product ?? null, script: u.script ?? null } : r)), [id]);

  /**
   * The script (hook + demo, modelled on the stolen clip), written once the product brief and the clip are both in.
   * It is the one source for everything after: "Plan it shot by shot" turns its shots into demo clips, and its hook
   * line replaces the stolen caption in the hook text (text the seller typed stays).
   */
  const planBusy = useRef(false);
  /** "Plan it shot by shot" was clicked while the script was still being written: build the clips when it lands. */
  const copyPending = useRef<string | null>(null);
  const [copyWaiting, setCopyWaiting] = useState(false);
  const refsRef = useRef(refs);
  useEffect(() => { refsRef.current = refs; }, [refs]);
  const writePlan = useCallback(async () => {
    // One at a time; a request that arrives meanwhile (another clip picked) runs right after, on the latest state.
    if (planBusy.current) { wantPlan.current = id; return; }
    planBusy.current = true;
    try {
      do {
        wantPlan.current = null;
        setPlanning(id);
        const saved = await waitRunSaves(id);
        const { run: r, error } = saved ? await writeScript(id) : { run: undefined, error: "Couldn't save your changes. Try again." };
        if (liveId.current !== id) return;
        setPlanning(null);
        if (!r?.script) { setToast(error ?? "Couldn't write the script. Try again."); continue; }
        takeAI(r);
        const cur = runRef.current;
        const source = refsRef.current?.find((x) => x.id === cur?.sourceRefId);
        // Never the seller's words: the default, the stolen clip's caption and title, and the previous script's lines.
        const placeholders = ["", DEFAULT_HOOK_TEXT, source?.recipe?.onScreenText?.[0]?.text, source?.title, ...(cur?.script ? [cur.script.hookText, ...cur.script.hookAlternatives] : [])];
        const line = cur ? runTexts(cur).find((x) => x.id === "hook") : undefined;
        const next = r.script.hookText;
        if (cur && line && next && placeholders.includes(line.text)) {
          save({ hook: { ...cur.hook, text: next }, texts: runTexts(cur).map((x) => (x.id === "hook" ? { ...x, text: next } : x)) });
        }
        if (copyPending.current === id && cur && r.script.shots.length && !demoClips(cur).some((c) => clipSrc(c))) {
          copyPending.current = null;
          setCopyWaiting(false);
          save({ demo: { ...cur.demo, mode: "clips", clips: r.script.shots.map((s) => ({ id: uid(), label: s.label, hint: s.hint, target: s.seconds, camera: s.camera, steps: s.steps, text: s.text })) } });
        }
      } while (wantPlan.current === id);
      // No script came (failed): copy the stolen video's own shots rather than leave the click hanging.
      const cur = runRef.current;
      if (copyPending.current === id && cur && !demoClips(cur).some((c) => clipSrc(c))) {
        copyPending.current = null;
        setCopyWaiting(false);
        const source = refsRef.current?.find((x) => x.id === cur.sourceRefId) ?? null;
        save({ demo: { ...cur.demo, mode: "clips", clips: shotList(source, cur).map((x) => ({ ...x, id: uid() })) } });
      }
    } finally {
      planBusy.current = false;
    }
  }, [id, takeAI, save]);

  /** Paste or Analyze: step 1 counts as done at once and the next step opens; the site is read in the background. */
  const analyzeProduct = useCallback((url: string) => {
    setProductJob({ runId: id, url });
    setPicked(undefined);
    void readProduct(id, url).then(({ run: r, error }) => {
      if (liveId.current !== id) return;
      if (r?.product) {
        takeAI(r);
        setProductJob((job) => (job?.url === url ? null : job));
        // The clip may already be picked: write the script now. Otherwise picking it does.
        const cur = runRef.current;
        if (wantPlan.current === id || cur?.sourceRefId || (cur?.hook.source === "describe" && cur.hook.describeReady)) void writePlan();
      } else {
        setProductJob((job) => (job?.url === url ? { runId: id, url, error: error ?? "Couldn't read that site. Try again." } : job));
        setPicked([1]);
      }
    });
  }, [id, takeAI, writePlan]);

  const onGenerated = useCallback((updated: Run) => setRun((r) => r?.id === updated.id ? { ...r, hook: updated.hook, texts: updated.texts, project: null } : r), []);
  const onGenerateFailed = useCallback(() => setPicked([4]), []);
  const gen = useHookGeneration(id, onGenerated, onGenerateFailed);

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

  /** Regenerate on the hook text: the next unused line written for this product (free), else three new ones (one AI call). */
  const seenHookText = useRef<Set<string>>(new Set());
  const regenerateHookText = useCallback(async (textId: string) => {
    const cur = runRef.current;
    if (!cur || cur.id !== id) return;
    if (!cur.product?.brief) return setToast("Add your product first (step 1).");
    const seen = seenHookText.current;
    const now = runTexts(cur).find((x) => x.id === textId)?.text;
    if (now) seen.add(now);
    const fits = cur.script && cur.script.refId === (cur.sourceRefId ?? null);
    let next = fits ? [cur.script!.hookText, ...cur.script!.hookAlternatives].find((x) => x && !seen.has(x)) : undefined;
    if (!next) {
      if (!(await waitRunSaves(id))) return setToast("Couldn't save your changes. Try again.");
      const { run: r, error } = await newHookLines(id, [...seen]);
      if (liveId.current !== id) return;
      if (!r?.script?.hookText) return setToast(error ?? "Couldn't write a new line. Try again.");
      takeAI(r);
      next = r.script.hookText;
    }
    seen.add(next);
    liveTexts((t) => t.map((x) => (x.id === textId ? { ...x, text: next! } : x)));
    commitTexts();
  }, [id, takeAI, liveTexts, commitTexts]);

  const beforeExport = useCallback(async () => {
    const dirty=saveTimer.current||adjustTimer.current;
    if(saveTimer.current)clearTimeout(saveTimer.current);
    if(adjustTimer.current)clearTimeout(adjustTimer.current);
    saveTimer.current=adjustTimer.current=null;
    const cur=runRef.current;
    if(dirty&&cur?.id===id){
      const saved=await patchRun(id,{hook:cur.hook,demo:cur.demo,texts:runTexts(cur),project:null});
      if(!saved)throw Error("Couldn't save your changes. Try again.");
    }
  },[id]);

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
        Couldn&apos;t load this video. Try again.
        <Link href="/studio" className="font-semibold text-accent">
          Back to runs
        </Link>
      </div>
    );
  }
  if (!run || run.id !== id || !refs) {
    return (
      <RouteSkeleton path={`/studio/${id}`} />
    );
  }

  const source = refs.find((r) => r.id === run.sourceRefId) ?? null;
  const hook = run.hook;
  const ready = Boolean(hook.generated) && demoClips(run).some((c) => clipSrc(c));
  const texts = runTexts(run);
  const pickHook = async (ref: Reference, from: HookSource = "library") => {
    if (ref.partial) {
      const response = await fetch(`/api/references/${ref.id}`, { cache: "no-store" });
      if (!response.ok) throw Error("Couldn't load the hook. Try again.");
      const full = await response.json() as Reference;
      ref = { ...full, coverUrl: ref.coverUrl, partial: false };
      setRefs(old => old?.map(r => r.id === full.id ? ref : r) ?? old);
    }
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
    requestScript();
  };
  /** A clip was chosen (an explicit click): write the script now, or as soon as the site has been read. */
  const requestScript = () => {
    if (productReading) wantPlan.current = run.id;
    else if (run.product?.brief) void writePlan();
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
    await pickHook(r, "upload");
  };
  const segs = timeline(run, source);
  const videoLen = videoLength(segs);
  const hasDemo = demoClips(run).some((c) => clipSrc(c));
  const job = productJob?.runId === run.id ? productJob : null;
  const productReading = Boolean(job && !job.error);
  const planningHere = planning === run.id;
  // Started work counts as done (the next step opens at once); the check spins until the result is in.
  const stepDone = runSteps(run);
  if (productReading) stepDone[0] = true;
  if (job?.error) stepDone[0] = false;
  if (gen.busy) stepDone[3] = true;
  const stepPending = [productReading, false, false, gen.busy, false, false];
  // Step 1 stays open (for the optional context) until the seller opens step 2, unless a hook is already in.
  const holdProduct = !stepDone[1] && productOk !== run.id && !job?.error && Boolean(run.product?.brief || productReading);
  const current = holdProduct ? 1 : stepDone.findIndex((d) => !d) + 1 || stepDone.length; // 1-based; all done = last step
  /** Generate: the hook clip and the demo plan start together; step 5 opens while both run. */
  const startGenerate = (note?: string) => {
    if (gen.busy) return;
    setPicked([5]);
    void gen.generate(note);
    // A link still being read replaces the script when it lands, so the plan is written after it.
    if (!productReading && run.script?.shots.length && run.script.refId === (run.sourceRefId ?? null)) return;
    wantPlan.current = run.id;
    if (run.product?.brief && !productReading && !planningHere) void writePlan();
  };
  const host = (() => {
    try { return job ? new URL(/^https?:\/\//i.test(job.url) ? job.url : `https://${job.url}`).hostname.replace(/^www\./, "") : undefined; } catch { return job?.url; }
  })();
  const ch = hook.face?.kind === "character" ? characterById(hook.face.id) : null;
  const facePhoto = ch ? ch.view : hook.face?.kind === "photo" ? `/api/media/${hook.face.mediaId}` : null;
  // The open step: the user's choice, else the first unfinished one. Finishing a step clears the choice (moves on).
  const openSteps = picked ?? [current];
  const toggleStep = (n: number) => {
    // Opening step 2 by its title moves on: step 1 closes.
    if (n === 2 && holdProduct) { setProductOk(run.id); return setPicked([2]); }
    setPicked(openSteps.includes(n) ? openSteps.filter((x) => x !== n) : [...openSteps, n]);
  };
  const faceName = hook.face?.kind === "character" ? characterById(hook.face.id)?.name : hook.face?.kind === "photo" ? "Your photo" : hook.face?.kind === "described" ? hook.face.text : undefined;
  const stepSummary = [
    productReading ? host : run.product?.brief.name,
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
        : { id: uid(), text, start: ws, end: we, x: 50, y: TEXT_Y.top, size: 4.6, font: DEFAULT_FONT, color: "#ffffff", style: "outline" };
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
  const applyGenerated = (generated: NonNullable<Run["hook"]["generated"]>, text: string, extra: Partial<Run["hook"]> = {}, sourceRefId?: string | null, blankText = false) => {
    const sp = speedOf(hook.adjust);
    const nextSpeed = "adjust" in extra ? speedOf(extra.adjust) : sp;
    const old = segs[0];
    const moved = retimeTexts(texts, 0, { start: 0, end: old.len * sp, speed: sp }, { start: 0, end: generated.seconds, speed: nextSpeed });
    const base = moved.find((x) => x.id === "hook");
    const end = round1(generated.seconds / nextSpeed);
    const item: TextLayer = base
      ? { ...base, text: blankText ? "" : base.text && base.text !== DEFAULT_HOOK_TEXT ? base.text : text }
      : { id: "hook", text: blankText ? "" : text, start: 0, end, x: 50, y: TEXT_Y.top, size: 4.6, font: DEFAULT_FONT, color: "#ffffff", style: "outline" };
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
  /** Puts an uploaded video into a demo clip. Texts after it move later by its length (or by the change, when replacing). */
  const fillClip = async (clipId: string, file: File, startClips?: DemoClip[], mode?: "single" | "clips") => {
    const c = await clipFromFile(file);
    setLibraryKey((k) => k + 1);
    const cur = runRef.current ?? run;
    if (cur.id !== id) return;
    const seconds = clipSeconds(c.length);
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
    // First video for a copied shot: its captions go on screen over it (editable like any text), one after another
    // ("1. ... / 2. ..." = two captions, each its share of the clip). Always the demo look (founder 2026-10-29):
    // TikTok Sans, white with a black outline; only the position follows the viral video.
    const suggested = list.find((x) => x.id === clipId)?.text;
    if (now && !old && suggested) {
      const captions = suggested.split(/\s+\/\s+/).map((t) => t.trim()).filter(Boolean);
      const each = now.len / captions.length;
      nextTexts = [...nextTexts, ...captions.map((t, k): TextLayer => ({
        id: uid(), text: t, start: round1(now.offset + k * each), end: round1(now.offset + (k + 1) * each),
        x: 50, y: viralCaptionY(), size: 4.6, font: DEFAULT_FONT, color: "#ffffff", style: "outline", second: "#000000",
      }))];
    }
    save({ demo: nextRun.demo, texts: nextTexts });
  };
  /** Where the stolen video puts its demo captions (top, center or bottom), from its analysis; center when unknown. */
  const viralCaptionY = (): number => {
    const position = (((source?.recipe?.onScreenText ?? []) as { position?: string }[]).slice(1).find((x) => x.position)?.position ?? "").toLowerCase();
    return position.includes("bottom") ? TEXT_Y.bottom : position.includes("top") ? TEXT_Y.top : TEXT_Y.center;
  };
  /** "Upload your demo" with one or more videos: one = a single demo, several = clips 1..N in file-name order (IMG_001, IMG_002...).
   *  `at` = insert before this demo clip (the editor's + Clips at the playhead); default at the end. Texts from there on move later. */
  const addVideos = async (files: File[], at?: number) => {
    const sorted = [...files].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
    const ups = await Promise.all(sorted.map((f) => clipFromFile(f)));
    setLibraryKey((k) => k + 1);
    const count = demoClips(runRef.current ?? run).length;
    const added: DemoClip[] = ups.map((c, i) => {
      const seconds = clipSeconds(c.length);
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
    reorderClips(next);
  };
  /** A tile dropped on another: the two clips trade places, each with its texts. */
  const swapClips = (a: string, b: string) => {
    const clips = demoClips(run);
    const i = clips.findIndex((c) => c.id === a);
    const j = clips.findIndex((c) => c.id === b);
    if (i < 0 || j < 0 || i === j) return;
    const next = [...clips];
    [next[i], next[j]] = [next[j], next[i]];
    reorderClips(next);
  };
  /** Put the demo clips in this order. Texts that sit on one clip go with it; texts across several clips keep their time. */
  const reorderClips = (next: DemoClip[]) => {
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
        <SaveStatus id={run.id} />
        <button type="button" onClick={() => setLibraryOpen(true)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-muted hover:bg-raised hover:text-text">
          <FolderOpen className="h-4 w-4" />
          My files
        </button>
        <button
          type="button"
          onClick={async () => {
            if (deleting.current || !confirm("Delete this run?")) return;
            deleting.current = true; setDeleteBusy(true);
            const response = await fetch(`/api/runs/${run.id}`, { method: "DELETE" }).catch(() => null);
            deleting.current = false; setDeleteBusy(false);
            if (!response?.ok) return setToast("Couldn't delete the video. Try again.");
            window.dispatchEvent(new CustomEvent("mavya:navigate", { detail: "/studio" }));
            router.push("/studio");
          }}
          className="rounded-lg p-2 text-soft hover:bg-raised hover:text-text"
          disabled={deleteBusy}
          aria-label="Delete video"
          title="Delete video"
        >
          {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
        <ExportButton
          run={run}
          beforeExport={beforeExport}
          ready={ready}
          onToast={setToast}
          // Saved on the server already; only the page's copy needs it (My files).
          onDone={(x) => setRun((r) => (r?.id === run.id ? { ...r, exports: [...(r.exports ?? []), x] } : r))}
        />
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
              <SourcePicker onLoadMore={refCursor ? async () => { const p = await libraryMore(refCursor); setRefs(old => [...new Map([...p.items, ...(old ?? [])].map(r => [r.id,r])).values()]); setRefCursor(p.next); } : undefined} refs={refs} source={null} onRefsChange={setRefs} onPick={pickHook} onClear={() => undefined} />
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:grid xl:grid-cols-[minmax(0,1fr)_400px] xl:overflow-hidden">
        <div className="shrink-0 xl:min-h-0 xl:overflow-y-auto">
          <div className="mx-auto max-w-[760px] divide-y divide-line px-8">
            <Block n={1} title="Your product" done={stepDone[0]} pending={stepPending[0]} open={openSteps.includes(1)} summary={stepSummary[0]} onToggle={() => toggleStep(1)}>
              <ProductStep
                key={job?.error ? `failed:${job.url}` : "product"}
                product={run.product ?? null}
                reading={productReading}
                host={host}
                error={job?.error ?? null}
                failedUrl={job?.error ? job.url : undefined}
                onAnalyze={analyzeProduct}
                notes={run.productNotes ?? ""}
                files={run.productScreens ?? []}
                writing={planningHere}
                onAddFiles={async (files) => {
                  const ups = await Promise.all(files.map((f) => uploadFile(f, false)));
                  const cur = runRef.current ?? run;
                  save({ productScreens: [...(cur.productScreens ?? []), ...ups.map((u) => u.mediaId)].slice(0, 5) });
                }}
                onRemoveFile={(mediaId) => save({ productScreens: ((runRef.current ?? run).productScreens ?? []).filter((x) => x !== mediaId) })}
                onSend={(notes) => {
                  if (notes !== (run.productNotes ?? "")) save({ productNotes: notes });
                  // Send is the explicit click: with a clip picked, the script is rewritten with the new context.
                  if (run.sourceRefId || (hook.source === "describe" && hook.describeReady)) requestScript();
                }}
                onSave={(notes) => {
                  if (notes !== ((runRef.current ?? run).productNotes ?? "")) save({ productNotes: notes });
                }}
              />
            </Block>

            <Block n={2} title="Steal a hook that already works" done={stepDone[1]} open={openSteps.includes(2)} summary={stepSummary[1]} onToggle={() => toggleStep(2)}>
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
                  <SourcePicker onLoadMore={refCursor ? async () => { const p = await libraryMore(refCursor); setRefs(old => [...new Map([...p.items, ...(old ?? [])].map(r => [r.id,r])).values()]); setRefCursor(p.next); } : undefined} refs={refs} source={source} onRefsChange={setRefs} onPick={pickHook} onClear={resetHook} />
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
                          <MediaVideo src={`/api/media/${staged.mediaId}#t=0.5`} muted preload="metadata" className="h-[72px] w-[42px] rounded-md bg-ink object-cover" />
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
                        onSubmit={(describe) => {
                          save({ hook: { ...hook, source: "describe", describe, describeReady: true } });
                          requestScript();
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              {source?.analysis && <HookTiming duration={source.analysis.duration} start={hook.start ?? 0} end={hook.end ?? 3} onChange={(start, end) => save({ hook: { ...hook, start, end } })} />}
            </Block>

            <Block n={3} title="Choose your character" done={stepDone[2]} open={openSteps.includes(3)} summary={stepSummary[2]} onToggle={() => toggleStep(3)}>
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

            <Block n={4} title="Generate your hook" done={stepDone[3]} pending={stepPending[3]} open={openSteps.includes(4)} summary={stepSummary[3]} onToggle={() => toggleStep(4)}>
              <GenerateStep
                run={run}
                source={source}
                seg={segs[0]}
                texts={texts}
                gen={gen}
                onGenerate={startGenerate}
                onRegenerateText={run.product?.brief ? regenerateHookText : undefined}
                onPatch={patchText}
                onAdd={addText}
                onAdjust={(a) => liveAdjust("hook", a)}
                onParts={(parts) => setParts("hook", parts)}
                onApplyAll={applyTextToAll}
                onRemove={removeText}
              />
            </Block>

            <Block n={5} title="Add your demo" done={stepDone[4]} open={openSteps.includes(5)} summary={stepSummary[4]} onToggle={() => toggleStep(5)}>
              <DemoStep
                run={run}
                segs={segs}
                renderEditor={clipEditor}
                onFiles={async (files) => {
                  setPicked((p) => Array.from(new Set([...(p ?? openSteps), 5])));
                  await addVideos(files);
                }}
                copying={copyWaiting}
                onClips={() => {
                  // The script is the copy of the stolen video for this product; while it is being written, wait for it.
                  const coming = planningHere || (productReading && wantPlan.current === run.id);
                  if (coming && !(run.script?.shots.length && run.script.refId === (run.sourceRefId ?? null))) {
                    copyPending.current = run.id;
                    setCopyWaiting(true);
                    return;
                  }
                  save({ demo: { ...run.demo, mode: "clips", clips: shotList(source, run).map((x) => ({ ...x, id: uid() })) } });
                }}
                onUpload={async (cid, f) => {
                  setPicked((p) => Array.from(new Set([...(p ?? openSteps), 5])));
                  await fillClip(cid, f);
                }}
                onRename={(cid, label) => save({ demo: { ...run.demo, clips: demoClips(run).map((c) => (c.id === cid ? { ...c, label } : c)) } })}
                onDelete={deleteClip}
                onMove={moveClip}
                onSwap={swapClips}
                onReset={resetDemo}
              />
            </Block>

            <Block n={6} title="Add sound" done={stepDone[5]} open={openSteps.includes(6)} summary={stepSummary[5]} onToggle={() => toggleStep(6)}>
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
          <RunPreview run={run} source={source} texts={texts} hookCover={gen.busy && !hook.generated ? <Suspense fallback={<span className="absolute inset-0 bg-ink" />}><GenerateProgress photo={facePhoto} who={ch ? ch.name : "your character"} startedAt={gen.startedAt} estimate={220} /></Suspense> : undefined} />
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
            <Suspense fallback={<div className="shimmer h-full w-[420px] max-w-[calc(100vw-24px)] rounded-2xl" />}>
            <HistoryPanel
              run={run}
              refs={refs}
              refreshKey={libraryKey}
              onClose={() => setLibraryOpen(false)}
              onUseHook={(r) => {
                void pickHook(r, r.owner === "user" ? "upload" : "library").catch(() => setToast("Could not load the hook. Try again."));
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
                // The words do not come along: the hook text box is left empty (same look and spot) and step 3 opens to type them.
                applyGenerated(g, "", { face: from.hook.face ?? hook.face, source: from.hook.source, describe: from.hook.describe, describeReady: from.hook.describeReady, adjust: from.hook.adjust }, from.sourceRefId, true);
                setPicked([3]);
                setLibraryOpen(false);
                setToast("Hook replaced");
              }}
              onUseDemo={(clips, from) => {
                // The demo is replaced by that one, clips as they were cut (empty spaces left out), with its own texts:
                // the old demo's texts go, each of its texts lands on the same clip in this video.
                const copy = clips.map((c) => ({ ...c, id: uid(), gap: undefined }));
                const nextRun: Run = { ...run, demo: { ...run.demo, clip: null, mode: copy.length > 1 ? "clips" : "single", clips: copy } };
                const demoStart = segs[0].len;
                const theirs = timeline(from, null).filter((g) => g.id !== "hook");
                const ours = timeline(nextRun, source).filter((g) => g.id !== "hook");
                const r3 = (x: number) => Math.round(x * 1000) / 1000;
                const brought = runTexts(from).flatMap((x) => {
                  if (x.id === "hook") return [];
                  const i = theirs.findIndex((g) => x.start >= g.offset - 0.05 && x.start < g.offset + g.len);
                  if (i < 0 || !ours[i]) return [];
                  const d = ours[i].offset - theirs[i].offset;
                  return [{ ...x, id: uid(), start: r3(x.start + d), end: r3(x.end + d) }];
                });
                const kept = texts.filter((x) => x.id === "hook" || x.start < demoStart - 0.05);
                save({ demo: nextRun.demo, texts: [...kept, ...brought] });
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
            </Suspense>
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

/** "Saving..." / "Saved" next to the title; red while a save failed (it is retried). */
function SaveStatus({ id }: { id: string }) {
  const state = useSyncExternalStore(subscribeSaves, () => saveStateOf(id), () => "idle" as const);
  const error = useSyncExternalStore(subscribeSaves, () => saveErrorOf(id), () => null);
  if (state === "idle") return null;
  if (state === "error") return <span role="alert" className="text-[12.5px] font-semibold text-red-600">{error ?? "Couldn't save, retrying"}</span>;
  return (
    <span className="flex items-center gap-1 text-[12.5px] font-semibold text-soft">
      {state === "saved" && <Check className="h-3.5 w-3.5" />}
      {state === "saving" ? "Saving..." : "Saved"}
    </span>
  );
}

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

/** The sharp picture over its thumb: invisible until decoded, then a short fade. */
function SharpImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} decoding="async" ref={(el) => { if (el?.complete && el.naturalWidth && !loaded) setLoaded(true); }} onLoad={() => setLoaded(true)} className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${loaded ? "opacity-100" : "opacity-0"}`} />
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
                  onPointerEnter={() => { new Image().src = c.view; }}
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
            {/* Fixed frame: the already-loaded thumb shows at once, the sharp picture fades in over it, nothing moves. */}
            <div className="relative aspect-[768/1376] h-[calc(100vh-160px)] max-w-[calc(100vw-160px)] overflow-hidden rounded-2xl bg-ink shadow-[0_24px_64px_rgba(0,0,0,0.35)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shown.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <SharpImage key={shown.id} src={shown.view} alt={shown.name} />
            </div>
            {[-1, 1].map((d) => {
              const next = CHARACTERS[(viewing + d + CHARACTERS.length) % CHARACTERS.length];
              // eslint-disable-next-line @next/next/no-img-element
              return <img key={next.id} src={next.view} alt="" aria-hidden className="hidden" />;
            })}
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
/** A clip's real length, to the millisecond and never past its end: rounding up would ask for frames that do not
 *  exist and freeze or blank the join to the next clip. */
const clipSeconds = (length: number | null | undefined) => (length && length > 0 ? Math.floor(length * 1000) / 1000 : 3);

/**
 * A sticky magnet for timeline drags: an edge snaps to the nearest point within `tol`, and once it has snapped
 * it holds there until pulled clearly away (2.2 x tol), so it "stops for a while" like a real magnet.
 */


/** The subtitle that starts last at or before time `at` (the one a new subtitle copies its look from); else the first. */
function lookBefore(texts: TextLayer[], at: number): TextLayer | undefined {
  const before = texts.filter((x) => x.start <= at + 0.01).sort((a, b) => b.start - a.start);
  return before[0] ?? texts[0];
}

/** The outlined button next to a step's main button (the other ways to do the step); violet when its panel is open. */
const optionBtn = (on: boolean) =>
  `flex items-center gap-1.5 rounded-lg border px-3.5 py-2.5 text-[14px] font-semibold ${on ? "border-accent bg-accent-tint text-accent" : "border-line-strong bg-panel text-text hover:border-accent hover:text-accent"}`;

type Generation = ReturnType<typeof useHookGeneration>;

/** The hook generation job, owned by the page so it keeps running (and polling) while step 4 is closed.
 * Generate runs Kling Motion Control (fal.ai) on the server, as a background job: POST /api/runs/[id]/generate, then poll until the clip is saved. */
function useHookGeneration(runId: string, onGenerated: (updated: Run) => void, onFailed: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const submitting = useRef(false);
  const requestKey = useRef<string | null>(null);
  const callbacks = useRef({ onGenerated, onFailed });
  useEffect(() => { callbacks.current = { onGenerated, onFailed }; }, [onGenerated, onFailed]);
  // Resume only a previously reserved explicit request. Provider task IDs never enter browser state.
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/runs/${runId}/generate`, { signal: abort.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((reply) => {
        if (abort.signal.aborted || submitting.current || !reply.job) return;
        setStartedAt(Date.now());
        setBusy(true);
        setJobId(reply.job);
      }).catch(() => undefined);
    return () => abort.abort();
  }, [runId]);

  useEffect(() => {
    if (!jobId) return;
    const abort = new AbortController();
    const storageKey = `mavya-generation:${runId}`;
    void (async () => {
      let failures = 0;
      for (let i = 0; i < 400 && !abort.signal.aborted; i++) {
        const response = await fetch(`/api/runs/${runId}/generate?job=${jobId}`, { signal: abort.signal, cache: "no-store" }).catch(() => null);
        const check = await response?.json().catch(() => null) as { state?: string; error?: string; run?: Run } | null;
        if (abort.signal.aborted) return;
        if (check?.state === "done" || check?.state === "failed" || response?.status === 404) {
          if (check?.state === "done" && check.run) callbacks.current.onGenerated(check.run);
          else {
            setGenError(check?.error ?? "The generation failed. Try again.");
            callbacks.current.onFailed();
          }
          setBusy(false);
          setJobId(null);
          requestKey.current = null;
          try { sessionStorage.removeItem(storageKey); } catch { /* Storage can be unavailable. */ }
          return;
        }
        failures = response?.ok ? 0 : failures + 1;
        await waitForPoll(pollDelay(4000, failures, document.hidden), abort.signal);
      }
      if (!abort.signal.aborted) {
        setBusy(false);
        setJobId(null);
        setGenError("This is taking too long. Try again.");
        callbacks.current.onFailed();
      }
    })();
    return () => abort.abort();
  }, [jobId, runId]);

  async function generate(note?: string) {
    if (busy || submitting.current) return;
    submitting.current = true;
    setGenError(null);
    setBusy(true);
    setStartedAt(Date.now());
    const storageKey = `mavya-generation:${runId}`;
    if (!requestKey.current) {
      try { requestKey.current = sessionStorage.getItem(storageKey); } catch { /* Storage can be unavailable. */ }
      requestKey.current ??= crypto.randomUUID();
      try { sessionStorage.setItem(storageKey, requestKey.current); } catch { /* Storage can be unavailable. */ }
    }
    try {
      if (!(await waitRunSaves(runId))) throw new Error("Couldn't save your changes. Try again.");
      const response = await fetch(`/api/runs/${runId}/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: requestKey.current, note }),
      });
      const started = await response.json().catch(() => null) as { job?: string; error?: string; needsPlan?: boolean } | null;
      if (response.status === 402 && started?.needsPlan) {
        setBusy(false);
        requestKey.current = null;
        try { sessionStorage.removeItem(storageKey); } catch { /* Storage can be unavailable. */ }
        window.dispatchEvent(new CustomEvent("mavya:navigate", { detail: "/settings/plans" }));
        router.push("/settings/plans");
        return;
      }
      if (!response.ok || !started?.job) throw new Error(started?.error ?? "Couldn't start the generation. Try again.");
      setJobId(started.job);
    } catch (error) {
      setGenError(error instanceof Error ? error.message : "Couldn't start the generation. Try again.");
      setBusy(false);
      callbacks.current.onFailed();
    } finally {
      submitting.current = false;
    }
  }

  return { busy, error: genError, startedAt, generate };
}

/** Step 4: the hook clip, in the shared clip editor. Before generating, the video box shows the inputs and a Generate button.
 * The job itself lives on the page (`gen`), so this step can close as soon as Generate is clicked. */
function GenerateStep({ run, source, seg, texts, gen, onGenerate, onRegenerateText, onPatch, onAdd, onRemove, onParts, onAdjust, onApplyAll }: {
  onRegenerateText?: (textId: string) => Promise<void>;
  run: Run;
  source: Reference | null;
  seg: Seg;
  texts: TextLayer[];
  gen: Generation;
  onGenerate: (note?: string) => void;
  onPatch: (id: string, patch: Partial<TextLayer>) => void;
  onAdd: (afterId: string | null, window: [number, number]) => void;
  onRemove: (id: string) => void;
  onParts: (parts: Part[]) => void;
  onAdjust: (a: Partial<Adjust>) => void;
  onApplyAll?: (id: string) => void;
}) {
  const hook = run.hook;
  const { busy, error: genError, startedAt } = gen;
  const described = hook.source === "describe" && hook.describeReady ? hook.describe : null;
  const face = hook.face ?? null;
  const ch = face?.kind === "character" ? characterById(face.id) : null;
  const ready = (Boolean(source) || Boolean(described)) && Boolean(face);

  // Regenerate: optional note on what went wrong, passed to the next generation.
  const [regen, setRegen] = useState(false);
  const [fix, setFix] = useState("");
  const generate = (note?: string) => {
    setRegen(false);
    setFix("");
    onGenerate(note);
  };

  const mini = "h-[42px] w-[26px] rounded-[5px] border-2 border-white bg-ink object-cover object-top shadow-sm";
  const facePhoto = ch ? ch.view : face?.kind === "photo" ? `/api/media/${face.mediaId}` : null;
  const who = ch ? ch.name : "your character";
  const cover = busy ? (
    <GenerateProgress photo={facePhoto} who={who} startedAt={startedAt} estimate={220} />
  ) : !hook.generated ? (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4">
      {facePhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={facePhoto} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover object-top opacity-60 blur-md" />
      )}
      {facePhoto && <span className="absolute inset-0 bg-ink/35" />}
      <button type="button" disabled={!ready} title={ready ? undefined : "Pick a hook and a character first"} onClick={() => void generate()} className="btn-primary relative px-4 py-2.5 text-[14px] disabled:opacity-50">
        Generate hook
      </button>
      {genError && <p role="alert" className="relative rounded-md bg-ink/80 px-2.5 py-1.5 text-center text-[12.5px] font-semibold text-white">{genError}</p>}
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
      onRegenerateFirst={onRegenerateText}
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
          {hook.generated && !busy && genError && (
            <p role="alert" className="absolute inset-x-2 bottom-2 rounded-md bg-ink/80 px-2.5 py-1.5 text-center text-[12.5px] font-semibold text-white">{genError}</p>
          )}
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
function Block({ n, title, done, pending = false, children, open = true, summary, onToggle }: { n: number; title: string; done: boolean; /** Done from the seller's side, still finishing in the background: the check carries a spinning ring. */ pending?: boolean; children: React.ReactNode; open?: boolean; summary?: string; onToggle?: () => void }) {
  // Once opened, a step stays mounted and is only hidden: reopening is instant, its videos and state survive.
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <section className={open ? "space-y-4 py-6" : "py-4"}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-busy={pending || undefined} className="flex w-full items-center gap-3 text-left">
        <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${done ? "bg-accent text-white" : open ? "bg-accent-tint text-accent" : "bg-raised text-soft"}`}>
          {done ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
          {done && pending && <span aria-hidden className="absolute -inset-[3px] rounded-full border-2 border-accent/20 border-t-accent motion-safe:animate-spin" />}
        </span>
        <h2 className={`shrink-0 text-[17px] font-extrabold tracking-tight ${open || done ? "text-text" : "text-soft"}`}>{title}</h2>
        {!open && summary && <span className="min-w-0 truncate text-[13.5px] text-muted">{summary}</span>}
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-soft transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {/* Its own Suspense: a step's on-demand code (editor, demo, sound) must never fall back to the route's loading.tsx,
          which swaps the whole page for a skeleton. */}
      {seen && (
        <div hidden={!open} className="space-y-4">
          <Suspense fallback={<div className="shimmer h-48 rounded-2xl" />}>{children}</Suspense>
        </div>
      )}
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
