"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Diamond,
  Download,
  Film,
  ImageIcon,
  Laptop,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Trash2,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { FONTS, TEXT_COLORS, TEXT_STYLES, fontCss, type FontKey } from "@/lib/studio-data";
import { AVATAR_TONES, patchRun, round1, uid, uploadFile, videoLength } from "@/lib/client";
import { buildTimeline, clipLen, clipStarts, isTimeline, newVClip, sampleClip, sampleText, timelineEnd } from "@/lib/timeline";
import { ROLE_COLOR, ROLE_LABEL, type AClip, type Asset, type Reference, type Run, type TItem, type Timeline, type VClip } from "@/lib/types";
import { AvatarPlaceholder, LaptopFrame } from "@/components/frames";

type Sel = { kind: "clip" | "text" | "audio"; id: string } | null;

/* CapCut-style dark palette, local to the editor. */
const C = {
  bg: "#111113",
  panel: "#1b1b1e",
  panel2: "#242428",
  line: "#2e2e33",
  text: "#e8e8ec",
  muted: "#9a9aa3",
  soft: "#66666e",
  accent: "#7c5cff",
  video: "#1d6b70",
  textClip: "#9b4436",
  audio: "#22487f",
};

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const fr = Math.floor((s % 1) * 30);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}:${String(fr).padStart(2, "0")}`;
};

export function Editor() {
  const { id } = useParams<{ id: string }>();
  const [tl, setTl] = useState<Timeline | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [ref, setRef] = useState<Reference | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [missing, setMissing] = useState(false);
  const [past, setPast] = useState<Timeline[]>([]);
  const [future, setFuture] = useState<Timeline[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(90);
  const [toast, setToast] = useState<string | null>(null);
  const loaded = useRef(false);
  const dragBase = useRef<Timeline | null>(null);

  const loadAssets = useCallback(() => {
    fetch("/api/assets")
      .then((r) => r.json())
      .then((a: Asset[]) => setAssets(a))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/runs/${id}`);
      if (!res.ok) throw new Error("missing");
      const r = (await res.json()) as Run;
      const reference = r.sourceRefId ? await fetch(`/api/references/${r.sourceRefId}`).then((x) => (x.ok ? (x.json() as Promise<Reference>) : null)) : null;
      if (!alive) return;
      setRun(r);
      setRef(reference);
      setTl(isTimeline(r.project) ? r.project : buildTimeline(r, reference));
      loaded.current = true;
    })().catch(() => alive && setMissing(true));
    const a = setTimeout(loadAssets, 0);
    return () => {
      alive = false;
      clearTimeout(a);
    };
  }, [id, loadAssets]);

  // Debounced autosave.
  useEffect(() => {
    if (!tl || !loaded.current) return;
    const timer = setTimeout(() => void patchRun(id, { project: tl }), 600);
    return () => clearTimeout(timer);
  }, [tl, id]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Commit a change to history (undo-able). */
  const commit = useCallback((fn: (p: Timeline) => Timeline) => {
    setTl((cur) => {
      if (!cur) return cur;
      const next = fn(cur);
      if (next === cur) return cur;
      setPast((p) => [...p.slice(-60), cur]);
      setFuture([]);
      return next;
    });
  }, []);
  /** Live change during a drag; history is written once on release. */
  const live = useCallback((fn: (p: Timeline) => Timeline) => setTl((cur) => (cur ? fn(cur) : cur)), []);
  const beginDrag = useCallback(() => {
    dragBase.current = tl;
  }, [tl]);
  const endDrag = useCallback(() => {
    const base = dragBase.current;
    dragBase.current = null;
    if (base && base !== tl) {
      setPast((p) => [...p.slice(-60), base]);
      setFuture([]);
    }
  }, [tl]);

  const undo = useCallback(() => {
    if (!past.length || !tl) return;
    setFuture((f) => [tl, ...f]);
    setTl(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }, [past, tl]);
  const redo = useCallback(() => {
    if (!future.length || !tl) return;
    setPast((p) => [...p, tl]);
    setTl(future[0]);
    setFuture((f) => f.slice(1));
  }, [future, tl]);

  const total = tl ? timelineEnd(tl) : 1;
  const starts = useMemo(() => (tl ? clipStarts(tl.clips) : []), [tl]);

  // Playback clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      setT((cur) => {
        const next = cur + dt;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const split = useCallback(() => {
    if (!tl) return;
    const target: Sel =
      sel ??
      (() => {
        const i = starts.findLastIndex((s) => t >= s);
        return i >= 0 && tl.clips[i] ? { kind: "clip" as const, id: tl.clips[i].id } : null;
      })();
    if (!target) return;
    commit((p) => {
      if (target.kind === "clip") {
        const i = p.clips.findIndex((c) => c.id === target.id);
        if (i < 0) return p;
        const c = p.clips[i];
        const local = t - clipStarts(p.clips)[i];
        if (local < 0.1 || local > clipLen(c) - 0.1) return p;
        const at = c.in + local * c.speed;
        const a: VClip = { ...c, out: at, keys: c.keys?.filter((k) => k.t <= local) };
        const b: VClip = { ...c, id: uid(), in: at, keys: c.keys?.filter((k) => k.t > local).map((k) => ({ ...k, t: k.t - local })) };
        return { ...p, clips: [...p.clips.slice(0, i), a, b, ...p.clips.slice(i + 1)] };
      }
      if (target.kind === "text") {
        const x = p.texts.find((y) => y.id === target.id);
        if (!x || t <= x.start + 0.1 || t >= x.end - 0.1) return p;
        return { ...p, texts: p.texts.flatMap((y) => (y.id === x.id ? [{ ...y, end: round1(t) }, { ...y, id: uid(), start: round1(t), keys: undefined }] : [y])) };
      }
      const a = p.audio.find((y) => y.id === target.id);
      if (!a) return p;
      const local = t - a.start;
      if (local < 0.1 || local > a.out - a.in - 0.1) return p;
      return { ...p, audio: p.audio.flatMap((y) => (y.id === a.id ? [{ ...y, out: y.in + local }, { ...y, id: uid(), start: t, in: y.in + local }] : [y])) };
    });
  }, [tl, sel, starts, t, commit]);

  const remove = useCallback(() => {
    if (!sel) return;
    commit((p) => ({
      ...p,
      clips: sel.kind === "clip" ? p.clips.filter((c) => c.id !== sel.id) : p.clips,
      texts: sel.kind === "text" ? p.texts.filter((c) => c.id !== sel.id) : p.texts,
      audio: sel.kind === "audio" ? p.audio.filter((c) => c.id !== sel.id) : p.audio,
    }));
    setSel(null);
  }, [sel, commit]);

  const duplicate = useCallback(() => {
    if (!sel) return;
    commit((p) => {
      if (sel.kind === "clip") {
        const i = p.clips.findIndex((c) => c.id === sel.id);
        return i < 0 ? p : { ...p, clips: [...p.clips.slice(0, i + 1), { ...p.clips[i], id: uid() }, ...p.clips.slice(i + 1)] };
      }
      if (sel.kind === "text") {
        const x = p.texts.find((y) => y.id === sel.id);
        return x ? { ...p, texts: [...p.texts, { ...x, id: uid(), row: Math.max(...p.texts.map((y) => y.row)) + 1 }] } : p;
      }
      return p;
    });
  }, [sel, commit]);

  const addText = useCallback(() => {
    const item: TItem = { id: uid(), row: 0, text: "Your text", start: round1(t), end: round1(t + 2.5), x: 50, y: 50, size: 4.6, font: "montserrat", color: "#ffffff", style: "outline" };
    commit((p) => {
      // First free row at the playhead.
      let row = 0;
      while (p.texts.some((x) => x.row === row && x.start < item.end && x.end > item.start)) row++;
      return { ...p, texts: [...p.texts, { ...item, row }] };
    });
    setSel({ kind: "text", id: item.id });
  }, [t, commit]);

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      } else if (e.key.toLowerCase() === "s" && !mod) {
        split();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        remove();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, split, remove, duplicate]);

  async function addAsset(a: Asset, durationHint: number | null) {
    if (a.kind === "audio") {
      const len = durationHint ?? (await audioLength(a.mediaId));
      commit((p) => ({ ...p, audio: [...p.audio, { id: uid(), mediaId: a.mediaId, name: a.name, start: round1(t), in: 0, out: len ?? 10, srcLength: len, volume: 80 }] }));
      return;
    }
    const len = a.kind === "video" ? (durationHint ?? (await videoLength(a.mediaId))) : null;
    const clip = newVClip({ kind: a.kind, mediaId: a.mediaId, name: a.name, in: 0, out: a.kind === "video" ? (len ?? 5) : 3, srcLength: a.kind === "video" ? len : null });
    insertClip(clip);
  }

  function insertClip(clip: VClip) {
    commit((p) => {
      const i = sel?.kind === "clip" ? p.clips.findIndex((c) => c.id === sel.id) : -1;
      const at = i >= 0 ? i + 1 : p.clips.length;
      return { ...p, clips: [...p.clips.slice(0, at), clip, ...p.clips.slice(at)] };
    });
    setSel({ kind: "clip", id: clip.id });
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      await uploadFile(f, true).catch((e: unknown) => setToast(e instanceof Error ? e.message : "Upload failed"));
    }
    loadAssets();
  }

  if (missing) {
    return (
      <div className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-3" style={{ background: C.bg, color: C.muted }}>
        Run not found
        <Link href="/studio" className="font-semibold" style={{ color: C.accent }}>
          Back to runs
        </Link>
      </div>
    );
  }
  if (!tl || !run) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center" style={{ background: C.bg, color: C.soft }}>
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const time = Math.min(t, total);
  const clipIndex = starts.findLastIndex((s, i) => time >= s && time < s + clipLen(tl.clips[i]));
  const selClip = sel?.kind === "clip" ? tl.clips.find((c) => c.id === sel.id) ?? null : null;
  const selText = sel?.kind === "text" ? tl.texts.find((c) => c.id === sel.id) ?? null : null;
  const selAudio = sel?.kind === "audio" ? tl.audio.find((c) => c.id === sel.id) ?? null : null;
  const used = new Set([...tl.clips.map((c) => c.mediaId), ...tl.audio.map((a) => a.mediaId)]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col text-[13px]" style={{ background: C.bg, color: C.text }}>
      <header className="flex h-11 shrink-0 items-center justify-between px-3" style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }}>
        <div className="flex min-w-0 items-center gap-2">
          <Link href={`/studio/${id}`} className="flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold hover:bg-white/5" style={{ color: C.muted }}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <span className="truncate font-bold">{run.title}</span>
        </div>
        <button type="button" onClick={() => setToast("Rendering is not connected yet.")} className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 font-bold text-white hover:brightness-110" style={{ background: C.accent }}>
          <Download className="h-4 w-4" />
          Export
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,26%)_1fr_minmax(280px,24%)] gap-px" style={{ background: C.line }}>
        <MediaBin assets={assets} used={used} reference={ref} onImport={importFiles} onAdd={(a, d) => void addAsset(a, d)} onAddSource={(seg) => ref && insertClip(newVClip({ kind: "video", mediaId: ref.mediaId, name: `Source ${ROLE_LABEL[seg.role]}`, in: seg.start, out: seg.end, srcLength: ref.analysis?.duration ?? null }))} />
        <Preview tl={tl} starts={starts} time={time} clipIndex={clipIndex} playing={playing} total={total} sel={sel} onSel={setSel} onPlay={() => setPlaying((p) => (time >= total ? (setT(0), true) : !p))} live={live} beginDrag={beginDrag} endDrag={endDrag} />
        <Inspector tl={tl} clip={selClip} text={selText} audio={selAudio} local={selClip ? time - starts[tl.clips.indexOf(selClip)] : selText ? time - selText.start : 0} commit={commit} />
      </div>

      <TimelineView
        tl={tl}
        starts={starts}
        total={total}
        time={time}
        pps={pps}
        sel={sel}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onPps={setPps}
        onSeek={(v) => {
          setPlaying(false);
          setT(Math.max(0, Math.min(total, v)));
        }}
        onSel={setSel}
        onUndo={undo}
        onRedo={redo}
        onSplit={split}
        onDelete={remove}
        onDuplicate={duplicate}
        onAddText={addText}
        live={live}
        beginDrag={beginDrag}
        endDrag={endDrag}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 font-semibold text-white shadow-lg" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function audioLength(mediaId: string): Promise<number | null> {
  return new Promise((resolve) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => resolve(null);
    a.src = `/api/media/${mediaId}`;
  });
}

/* ---------------- Media bin ---------------- */

function MediaBin({
  assets,
  used,
  reference,
  onImport,
  onAdd,
  onAddSource,
}: {
  assets: Asset[];
  used: Set<string | null>;
  reference: Reference | null;
  onImport: (f: FileList | null) => void;
  onAdd: (a: Asset, duration: number | null) => void;
  onAddSource: (seg: NonNullable<Reference["analysis"]>["segments"][number]) => void;
}) {
  const [tab, setTab] = useState<"media" | "audio" | "source">("media");
  const [importing, setImporting] = useState(false);
  const items = assets.filter((a) => (tab === "audio" ? a.kind === "audio" : a.kind !== "audio"));
  return (
    <div className="flex min-h-0 flex-col" style={{ background: C.panel }}>
      <div className="flex items-center gap-1 px-2 pt-2">
        {(["media", "audio", "source"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className="rounded-md px-3 py-1.5 font-semibold capitalize" style={tab === k ? { background: C.panel2, color: C.text } : { color: C.muted }}>
            {k}
          </button>
        ))}
        <label className={`ml-auto flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 font-semibold text-white hover:brightness-110 ${importing ? "pointer-events-none opacity-50" : ""}`} style={{ background: C.accent }}>
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Import
          <input
            type="file"
            multiple
            accept="video/*,image/png,image/jpeg,audio/*"
            className="hidden"
            onChange={async (e) => {
              const files = e.target.files;
              setImporting(true);
              await onImport(files);
              setImporting(false);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === "source" ? (
          reference?.analysis ? (
            <div className="grid grid-cols-3 gap-2">
              {reference.analysis.segments.map((s, i) => (
                <BinTile key={i} label={`${ROLE_LABEL[s.role]} ${i + 1}`} duration={s.end - s.start} badgeColor={ROLE_COLOR[s.role]} onAdd={() => onAddSource(s)}>
                  {s.thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumb} alt="" className="h-full w-full object-cover" />
                  )}
                </BinTile>
              ))}
            </div>
          ) : (
            <Empty>No source video in this run</Empty>
          )
        ) : items.length === 0 ? (
          <Empty>{tab === "audio" ? "Import music or voiceover" : "Import clips, recordings and photos"}</Empty>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map((a) => (
              <AssetTile key={a.mediaId} a={a} added={used.has(a.mediaId)} onAdd={onAdd} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg text-center" style={{ border: `1px dashed ${C.line}`, color: C.soft }}>
      {children}
    </div>
  );
}

function AssetTile({ a, added, onAdd }: { a: Asset; added: boolean; onAdd: (a: Asset, d: number | null) => void }) {
  const [dur, setDur] = useState<number | null>(null);
  return (
    <BinTile label={a.name} duration={dur} added={added} onAdd={() => onAdd(a, dur)}>
      {a.kind === "video" ? (
        <video src={`/api/media/${a.mediaId}#t=0.3`} muted preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} className="h-full w-full object-cover" />
      ) : a.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/media/${a.mediaId}`} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center" style={{ background: C.audio }}>
          <Music className="h-6 w-6 text-white/70" />
          <audio src={`/api/media/${a.mediaId}`} preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} className="hidden" />
        </div>
      )}
    </BinTile>
  );
}

function BinTile({ label, duration, added, badgeColor, onAdd, children }: { label: string; duration: number | null; added?: boolean; badgeColor?: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="group min-w-0">
      <button type="button" onDoubleClick={onAdd} className="relative block aspect-square w-full overflow-hidden rounded-lg" style={{ background: C.panel2 }}>
        {children}
        {added && <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">Added</span>}
        {badgeColor && <span className="absolute inset-x-0 top-0 h-1" style={{ background: badgeColor }} />}
        {duration != null && Number.isFinite(duration) && <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">{`00:${String(Math.round(duration)).padStart(2, "0")}`}</span>}
        <span
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-md text-white opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: C.accent }}
          role="button"
          aria-label="Add to timeline"
        >
          <Plus className="h-4 w-4" strokeWidth={2.6} />
        </span>
      </button>
      <div className="mt-1 truncate text-[11px]" style={{ color: C.muted }}>
        {label}
      </div>
    </div>
  );
}

/* ---------------- Preview ---------------- */

function Preview({
  tl,
  starts,
  time,
  clipIndex,
  playing,
  total,
  sel,
  onSel,
  onPlay,
  live,
  beginDrag,
  endDrag,
}: {
  tl: Timeline;
  starts: number[];
  time: number;
  clipIndex: number;
  playing: boolean;
  total: number;
  sel: Sel;
  onSel: (s: Sel) => void;
  onPlay: () => void;
  live: (fn: (p: Timeline) => Timeline) => void;
  beginDrag: () => void;
  endDrag: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const clip = clipIndex >= 0 ? tl.clips[clipIndex] : null;
  const local = clip ? time - starts[clipIndex] : 0;

  function drag(e: React.PointerEvent, apply: (dx: number, dy: number, rect: DOMRect) => void) {
    e.preventDefault();
    e.stopPropagation();
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX;
    const sy = e.clientY;
    beginDrag();
    const move = (ev: PointerEvent) => apply(((ev.clientX - sx) / rect.width) * 100, ((ev.clientY - sy) / rect.height) * 100, rect);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      endDrag();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const texts = tl.texts.filter((x) => (time >= x.start && time < x.end) || (sel?.kind === "text" && sel.id === x.id)).sort((a, b) => a.row - b.row);

  return (
    <div className="flex min-h-0 flex-col" style={{ background: C.bg }}>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3" onPointerDown={(e) => e.target === e.currentTarget && onSel(null)}>
        <div
          ref={box}
          className="relative aspect-[9/16] h-full max-h-full overflow-hidden bg-black [container-type:size]"
          onPointerDown={(e) => {
            if (!clip) return;
            onSel({ kind: "clip", id: clip.id });
            const k = sampleClip(clip, local);
            drag(e, (dx, dy) => live((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? setTransform(c, local, { x: round1(k.x + dx), y: round1(k.y + dy) }) : c)) })));
          }}
        >
          {clip && <ClipLayer clip={clip} local={local} playing={playing} />}
          {tl.audio.map((a) => (
            <AudioLayer key={a.id} a={a} time={time} playing={playing} />
          ))}
          {texts.map((x) => {
            const k = sampleText(x, time - x.start);
            const selected = sel?.kind === "text" && sel.id === x.id;
            const active = time >= x.start && time < x.end;
            return (
              <div
                key={x.id}
                onPointerDown={(e) => {
                  onSel({ kind: "text", id: x.id });
                  drag(e, (dx, dy) => live((p) => ({ ...p, texts: p.texts.map((y) => (y.id === x.id ? setTextKey(y, time - y.start, { x: round1(k.x + dx), y: round1(k.y + dy) }) : y)) })));
                }}
                className={`absolute cursor-move touch-none select-none ${active ? "" : "opacity-40"}`}
                style={{ left: `${k.x}%`, top: `${k.y}%`, transform: "translate(-50%, -50%)", maxWidth: "92%", width: "max-content", outline: selected ? "1.5px solid #fff" : undefined, outlineOffset: 4 }}
              >
                <TextRender x={x} size={k.size} />
                {selected && (
                  <span
                    onPointerDown={(e) =>
                      drag(e, (dx, dy, rect) => live((p) => ({ ...p, texts: p.texts.map((y) => (y.id === x.id ? setTextKey(y, time - y.start, { size: Math.max(1.5, Math.min(16, round1(k.size + (dy + dx * (rect.width / rect.height)) / 4))) }) : y)) })))
                    }
                    className="absolute -bottom-2.5 -right-2.5 h-4 w-4 cursor-nwse-resize rounded-full border-2 bg-white"
                    style={{ borderColor: C.accent }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex h-10 shrink-0 items-center justify-center gap-4 font-mono text-[12px]" style={{ borderTop: `1px solid ${C.line}` }}>
        <span style={{ color: C.accent }}>{fmt(time)}</span>
        <span style={{ color: C.soft }}>/ {fmt(total)}</span>
        <button type="button" onClick={onPlay} className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black hover:bg-white/90" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />}
        </button>
        <span className="rounded px-1.5 py-0.5 font-sans text-[11px] font-semibold" style={{ background: C.panel2, color: C.muted }}>
          9:16
        </span>
      </div>
    </div>
  );
}

function ClipLayer({ clip, local, playing }: { clip: VClip; local: number; playing: boolean }) {
  const k = sampleClip(clip, local);
  const at = clip.in + local * clip.speed;
  const media =
    clip.kind === "placeholder" ? (
      <AvatarPlaceholder tones={clip.tones ?? AVATAR_TONES[0]} label="AI creator" />
    ) : clip.kind === "image" ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/media/${clip.mediaId}`} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
    ) : (
      <SyncedMedia key={clip.id} kind="video" src={`/api/media/${clip.mediaId}`} at={at} playing={playing} rate={clip.speed} volume={clip.volume / 100} />
    );
  return (
    <div className="pointer-events-none absolute inset-0" style={{ transform: `translate(${k.x}%, ${k.y}%) scale(${k.scale / 100}) rotate(${k.rotate}deg)` }}>
      {clip.frame === "laptop" ? <LaptopFrame>{media}</LaptopFrame> : media}
    </div>
  );
}

function AudioLayer({ a, time, playing }: { a: AClip; time: number; playing: boolean }) {
  const active = time >= a.start && time < a.start + (a.out - a.in);
  if (!active) return null;
  return <SyncedMedia kind="audio" src={`/api/media/${a.mediaId}`} at={a.in + (time - a.start)} playing={playing} rate={1} volume={a.volume / 100} />;
}

/** A video or audio element that follows the timeline: plays with it, and seeks when scrubbed. */
function SyncedMedia({ kind, src, at, playing, rate, volume }: { kind: "video" | "audio"; src: string; at: number; playing: boolean; rate: number; volume: number }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const atRef = useRef(at);
  useEffect(() => {
    atRef.current = at;
  }, [at]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    m.playbackRate = rate;
    m.volume = Math.max(0, Math.min(1, volume));
  }, [rate, volume]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    if (playing) {
      if (Math.abs(m.currentTime - atRef.current) > 0.25) m.currentTime = atRef.current;
      void m.play().catch(() => undefined);
    } else m.pause();
  }, [playing]);
  useEffect(() => {
    const m = ref.current;
    if (!m || playing || m.readyState < 1) return;
    if (Math.abs(m.currentTime - at) > 0.04) m.currentTime = at;
  }, [at, playing]);
  const common = {
    ref,
    src,
    preload: "auto" as const,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      e.currentTarget.currentTime = atRef.current;
      e.currentTarget.playbackRate = rate;
      if (playing) void e.currentTarget.play().catch(() => undefined);
    },
  };
  return kind === "video" ? <video {...common} playsInline className="pointer-events-none absolute inset-0 h-full w-full object-cover" /> : <audio {...common} className="hidden" />;
}

function TextRender({ x, size }: { x: TItem; size: number }) {
  const light = ["#ffffff", "#facc15", "#22c55e", "#38bdf8", "#e879f9", "#f97316"].includes(x.color);
  const base: React.CSSProperties = { fontFamily: fontCss(x.font), fontSize: `${size}cqh`, fontWeight: 800, lineHeight: 1.12, textAlign: "center", whiteSpace: "pre-wrap", overflowWrap: "break-word", display: "block" };
  if (x.style === "box")
    return (
      <span style={base}>
        <span style={{ background: x.color, color: light ? "#000" : "#fff", padding: "0.08em 0.3em", borderRadius: "0.18em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>{x.text}</span>
      </span>
    );
  if (x.style === "outline") return <span style={{ ...base, color: x.color, WebkitTextStroke: `0.16em ${light ? "#000" : "#fff"}`, paintOrder: "stroke fill" }}>{x.text}</span>;
  if (x.style === "shadow") return <span style={{ ...base, color: x.color, textShadow: "0 0.06em 0.3em rgba(0,0,0,0.75)" }}>{x.text}</span>;
  return <span style={{ ...base, color: x.color }}>{x.text}</span>;
}

/* ---------------- Keyframe helpers ---------------- */

const KEY_EPS = 0.05;

/** With keyframes, an edit writes a keyframe at the playhead; without, it changes the clip's base values. */
function setTransform(c: VClip, local: number, patch: Partial<Pick<VClip, "scale" | "x" | "y" | "rotate">>): VClip {
  if (!c.keys?.length) return { ...c, ...patch };
  const cur = sampleClip(c, local);
  const next = { ...cur, ...patch, t: round1(local) };
  return { ...c, keys: [...c.keys.filter((k) => Math.abs(k.t - local) > KEY_EPS), next].sort((a, b) => a.t - b.t) };
}

function setTextKey(x: TItem, local: number, patch: Partial<Pick<TItem, "x" | "y" | "size">>): TItem {
  if (!x.keys?.length) return { ...x, ...patch };
  const cur = sampleText(x, local);
  const next = { ...cur, ...patch, t: round1(local) };
  return { ...x, keys: [...x.keys.filter((k) => Math.abs(k.t - local) > KEY_EPS), next].sort((a, b) => a.t - b.t) };
}

/* ---------------- Inspector ---------------- */

function Inspector({ tl, clip, text, audio, local, commit }: { tl: Timeline; clip: VClip | null; text: TItem | null; audio: AClip | null; local: number; commit: (fn: (p: Timeline) => Timeline) => void }) {
  const setClip = (fn: (c: VClip) => VClip) => clip && commit((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? fn(c) : c)) }));
  const setText = (fn: (x: TItem) => TItem) => text && commit((p) => ({ ...p, texts: p.texts.map((x) => (x.id === text.id ? fn(x) : x)) }));

  return (
    <div className="flex min-h-0 flex-col" style={{ background: C.panel }}>
      <div className="flex h-10 shrink-0 items-center px-4 font-bold" style={{ borderBottom: `1px solid ${C.line}` }}>
        {clip ? "Video" : text ? "Text" : audio ? "Audio" : "Project"}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {clip && <ClipInspector clip={clip} local={local} setClip={setClip} />}
        {text && <TextInspector x={text} local={local} setText={setText} />}
        {audio && (
          <Section title="Audio">
            <Row label="Volume">
              <Slider value={audio.volume} min={0} max={200} onChange={(v) => commit((p) => ({ ...p, audio: p.audio.map((a) => (a.id === audio.id ? { ...a, volume: v } : a)) }))} suffix="%" />
            </Row>
            <div className="truncate text-[12px]" style={{ color: C.muted }}>
              {audio.name}
            </div>
          </Section>
        )}
        {!clip && !text && !audio && (
          <Section title="Overview">
            {[
              ["Video clips", tl.clips.length],
              ["Text", tl.texts.length],
              ["Audio", tl.audio.length],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-0.5">
                <span style={{ color: C.muted }}>{k}</span>
                <span className="font-semibold">{v}</span>
              </div>
            ))}
            <div className="pt-3 text-[12px] leading-relaxed" style={{ color: C.soft }}>
              Space play · S split · Delete remove · Ctrl+Z undo · Ctrl+D duplicate
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3 px-4 py-3.5" style={{ borderBottom: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between">
        <span className="font-bold">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-2">
      <span style={{ color: C.muted }}>{label}</span>
      {children}
    </div>
  );
}

function Slider({ value, min, max, step = 1, suffix, onChange }: { value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1" style={{ accentColor: C.accent }} />
      <NumBox value={value} onChange={onChange} suffix={suffix} />
    </div>
  );
}

function NumBox({ value, onChange, suffix, prefix }: { value: number; onChange: (v: number) => void; suffix?: string; prefix?: string }) {
  return (
    <label className="flex w-[74px] items-center gap-1 rounded-md px-2 py-1" style={{ background: C.panel2 }}>
      {prefix && <span style={{ color: C.soft }}>{prefix}</span>}
      <input
        type="number"
        value={Math.round(value * 10) / 10}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-full min-w-0 bg-transparent text-right outline-none"
      />
      {suffix && <span style={{ color: C.soft }}>{suffix}</span>}
    </label>
  );
}

function KeyButton({ has, onToggle }: { has: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} title={has ? "Remove keyframe" : "Add keyframe at playhead"} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold hover:bg-white/5" style={{ color: has ? C.accent : C.muted }}>
      <Diamond className="h-3.5 w-3.5" fill={has ? C.accent : "none"} />
      Keyframe
    </button>
  );
}

function ClipInspector({ clip, local, setClip }: { clip: VClip; local: number; setClip: (fn: (c: VClip) => VClip) => void }) {
  const k = sampleClip(clip, local);
  const hasKey = Boolean(clip.keys?.some((x) => Math.abs(x.t - local) <= KEY_EPS));
  const patch = (p: Partial<Pick<VClip, "scale" | "x" | "y" | "rotate">>) => setClip((c) => setTransform(c, local, p));
  return (
    <>
      <Section
        title="Transform"
        right={
          <KeyButton
            has={hasKey}
            onToggle={() =>
              setClip((c) => {
                if (hasKey) {
                  const keys = c.keys?.filter((x) => Math.abs(x.t - local) > KEY_EPS);
                  return { ...c, keys: keys?.length ? keys : undefined };
                }
                const cur = sampleClip(c, local);
                return { ...c, keys: [...(c.keys ?? []), { ...cur, t: round1(local) }].sort((a, b) => a.t - b.t) };
              })
            }
          />
        }
      >
        <Row label="Scale">
          <Slider value={k.scale} min={10} max={300} onChange={(v) => patch({ scale: v })} suffix="%" />
        </Row>
        <Row label="Position">
          <div className="flex gap-2">
            <NumBox prefix="X" value={k.x} onChange={(v) => patch({ x: v })} />
            <NumBox prefix="Y" value={k.y} onChange={(v) => patch({ y: v })} />
          </div>
        </Row>
        <Row label="Rotate">
          <Slider value={k.rotate} min={-180} max={180} onChange={(v) => patch({ rotate: v })} suffix="°" />
        </Row>
        <button
          type="button"
          onClick={() => setClip((c) => ({ ...c, scale: 100, x: 0, y: 0, rotate: 0, keys: undefined }))}
          className="flex items-center gap-1.5 text-[12px] font-semibold hover:text-white"
          style={{ color: C.muted }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </Section>
      <Section title="Look">
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { id: undefined, label: "Normal", icon: Film },
            { id: "laptop" as const, label: "Phone on laptop", icon: Laptop },
          ].map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setClip((c) => ({ ...c, frame: f.id }))}
              className="flex items-center justify-center gap-1.5 rounded-md py-2 font-semibold"
              style={clip.frame === f.id ? { background: C.accent, color: "#fff" } : { background: C.panel2, color: C.muted }}
            >
              <f.icon className="h-4 w-4" />
              {f.label}
            </button>
          ))}
        </div>
      </Section>
      {clip.kind === "video" && (
        <Section title="Speed and audio">
          <div className="grid grid-cols-5 gap-1">
            {[0.5, 1, 1.2, 1.5, 2].map((s) => (
              <button key={s} type="button" onClick={() => setClip((c) => ({ ...c, speed: s }))} className="rounded-md py-1.5 font-semibold" style={clip.speed === s ? { background: C.accent, color: "#fff" } : { background: C.panel2, color: C.muted }}>
                {s}x
              </button>
            ))}
          </div>
          <Row label="Volume">
            <Slider value={clip.volume} min={0} max={200} onChange={(v) => setClip((c) => ({ ...c, volume: v }))} suffix="%" />
          </Row>
        </Section>
      )}
    </>
  );
}

function TextInspector({ x, local, setText }: { x: TItem; local: number; setText: (fn: (x: TItem) => TItem) => void }) {
  const k = sampleText(x, local);
  const hasKey = Boolean(x.keys?.some((y) => Math.abs(y.t - local) <= KEY_EPS));
  const patchKey = (p: Partial<Pick<TItem, "x" | "y" | "size">>) => setText((y) => setTextKey(y, local, p));
  return (
    <>
      <Section title="Text">
        <textarea value={x.text} onChange={(e) => setText((y) => ({ ...y, text: e.target.value }))} rows={3} className="w-full resize-y rounded-md px-2.5 py-2 outline-none" style={{ background: C.panel2, color: C.text }} />
      </Section>
      <Section title="Font">
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(FONTS) as FontKey[]).map((f) => (
            <button key={f} type="button" onClick={() => setText((y) => ({ ...y, font: f }))} className="rounded-md py-2" style={x.font === f ? { background: C.accent, color: "#fff" } : { background: C.panel2, color: C.text }}>
              <div className="text-[17px] leading-none" style={{ fontFamily: FONTS[f].css, fontWeight: 800 }}>
                Aa
              </div>
              <div className="mt-1 truncate text-[10px]" style={{ color: x.font === f ? "#fff" : C.muted }}>
                {FONTS[f].label}
              </div>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TEXT_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setText((y) => ({ ...y, color: c }))} className="h-6 w-6 rounded-full" style={{ background: c, outline: x.color === c ? `2px solid ${C.accent}` : `1px solid ${C.line}`, outlineOffset: 2 }} aria-label={c} />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1">
          {TEXT_STYLES.map((s) => (
            <button key={s.id} type="button" onClick={() => setText((y) => ({ ...y, style: s.id }))} className="rounded-md py-1.5 text-[12px] font-semibold" style={x.style === s.id ? { background: C.accent, color: "#fff" } : { background: C.panel2, color: C.muted }}>
              {s.label}
            </button>
          ))}
        </div>
      </Section>
      <Section
        title="Transform"
        right={
          <KeyButton
            has={hasKey}
            onToggle={() =>
              setText((y) => {
                if (hasKey) {
                  const keys = y.keys?.filter((z) => Math.abs(z.t - local) > KEY_EPS);
                  return { ...y, keys: keys?.length ? keys : undefined };
                }
                const cur = sampleText(y, local);
                return { ...y, keys: [...(y.keys ?? []), { ...cur, t: round1(local) }].sort((a, b) => a.t - b.t) };
              })
            }
          />
        }
      >
        <Row label="Size">
          <Slider value={k.size} min={1.5} max={16} step={0.1} onChange={(v) => patchKey({ size: v })} />
        </Row>
        <Row label="Position">
          <div className="flex gap-2">
            <NumBox prefix="X" value={k.x} onChange={(v) => patchKey({ x: v })} />
            <NumBox prefix="Y" value={k.y} onChange={(v) => patchKey({ y: v })} />
          </div>
        </Row>
        <div className="grid grid-cols-3 gap-1">
          {[
            ["Top", 22],
            ["Center", 50],
            ["Bottom", 76],
          ].map(([l, y]) => (
            <button key={l} type="button" onClick={() => patchKey({ x: 50, y: y as number })} className="rounded-md py-1.5 text-[12px] font-semibold hover:text-white" style={{ background: C.panel2, color: C.muted }}>
              {l}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

/* ---------------- Timeline ---------------- */

const GUTTER = 56;
const ROW_H = 30;

function TimelineView({
  tl,
  starts,
  total,
  time,
  pps,
  sel,
  canUndo,
  canRedo,
  onPps,
  onSeek,
  onSel,
  onUndo,
  onRedo,
  onSplit,
  onDelete,
  onDuplicate,
  onAddText,
  live,
  beginDrag,
  endDrag,
}: {
  tl: Timeline;
  starts: number[];
  total: number;
  time: number;
  pps: number;
  sel: Sel;
  canUndo: boolean;
  canRedo: boolean;
  onPps: (v: number) => void;
  onSeek: (t: number) => void;
  onSel: (s: Sel) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddText: () => void;
  live: (fn: (p: Timeline) => Timeline) => void;
  beginDrag: () => void;
  endDrag: () => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const rows = Math.max(2, ...tl.texts.map((x) => x.row + 2));
  const width = (total + 6) * pps;
  const px = (s: number) => s * pps;

  function track(onMove: (ev: PointerEvent) => void, onUp?: () => void) {
    beginDrag();
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      onUp?.();
      endDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  }

  function seekFrom(e: React.PointerEvent) {
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    const at = (x: number) => (x - rect.left) / pps;
    onSeek(at(e.clientX));
    const move = (ev: PointerEvent) => onSeek(at(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function dragClip(e: React.PointerEvent, c: VClip, mode: "move" | "left" | "right") {
    e.stopPropagation();
    onSel({ kind: "clip", id: c.id });
    const sx = e.clientX;
    const { in: in0, out: out0 } = c;
    const rect = area.current?.getBoundingClientRect();
    let target: number | null = null;
    track(
      (ev) => {
        const ds = (ev.clientX - sx) / pps;
        if (mode === "left") {
          const nin = Math.max(0, Math.min(out0 - 0.2, in0 + ds * c.speed));
          live((p) => ({ ...p, clips: p.clips.map((x) => (x.id === c.id ? { ...x, in: round1(nin) } : x)) }));
        } else if (mode === "right") {
          const max = c.srcLength ?? Infinity;
          const nout = Math.max(in0 + 0.2, Math.min(max, out0 + ds * c.speed));
          live((p) => ({ ...p, clips: p.clips.map((x) => (x.id === c.id ? { ...x, out: round1(nout) } : x)) }));
        } else if (rect) {
          const at = (ev.clientX - rect.left) / pps;
          let idx = tl.clips.length;
          for (let i = 0; i < tl.clips.length; i++) {
            if (at < starts[i] + clipLen(tl.clips[i]) / 2) {
              idx = i;
              break;
            }
          }
          target = idx;
          setInsertAt(idx);
        }
      },
      () => {
        if (mode === "move" && target !== null) {
          const to = target;
          live((p) => {
            const from = p.clips.findIndex((x) => x.id === c.id);
            if (from < 0) return p;
            const arr = [...p.clips];
            const [item] = arr.splice(from, 1);
            arr.splice(to > from ? to - 1 : to, 0, item);
            return { ...p, clips: arr };
          });
        }
        setInsertAt(null);
      }
    );
  }

  function dragText(e: React.PointerEvent, x: TItem, mode: "move" | "left" | "right") {
    e.stopPropagation();
    onSel({ kind: "text", id: x.id });
    const sx = e.clientX;
    const sy = e.clientY;
    const { start, end, row } = x;
    track((ev) => {
      const ds = (ev.clientX - sx) / pps;
      if (mode === "left") live((p) => ({ ...p, texts: p.texts.map((y) => (y.id === x.id ? { ...y, start: round1(Math.max(0, Math.min(end - 0.2, start + ds))) } : y)) }));
      else if (mode === "right") live((p) => ({ ...p, texts: p.texts.map((y) => (y.id === x.id ? { ...y, end: round1(Math.max(start + 0.2, end + ds)) } : y)) }));
      else {
        const len = end - start;
        const ns = round1(Math.max(0, start + ds));
        const nr = Math.max(0, row - Math.round((ev.clientY - sy) / ROW_H));
        live((p) => ({ ...p, texts: p.texts.map((y) => (y.id === x.id ? { ...y, start: ns, end: round1(ns + len), row: nr } : y)) }));
      }
    });
  }

  function dragAudio(e: React.PointerEvent, a: AClip, mode: "move" | "left" | "right") {
    e.stopPropagation();
    onSel({ kind: "audio", id: a.id });
    const sx = e.clientX;
    const { start, in: in0, out: out0 } = a;
    track((ev) => {
      const ds = (ev.clientX - sx) / pps;
      live((p) => ({
        ...p,
        audio: p.audio.map((y) => {
          if (y.id !== a.id) return y;
          if (mode === "move") return { ...y, start: round1(Math.max(0, start + ds)) };
          if (mode === "left") {
            const d = Math.max(-in0, Math.min(out0 - in0 - 0.2, ds));
            return { ...y, start: round1(start + d), in: round1(in0 + d) };
          }
          return { ...y, out: round1(Math.max(in0 + 0.2, Math.min(y.srcLength ?? Infinity, out0 + ds))) };
        }),
      }));
    });
  }

  const tick = pps >= 60 ? 1 : pps >= 30 ? 2 : 5;
  const ticks = Array.from({ length: Math.ceil((total + 6) / tick) }, (_, i) => i * tick);
  const toolBtn = "flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 disabled:opacity-30";

  return (
    <div className="flex h-[310px] shrink-0 flex-col" style={{ background: C.panel, borderTop: `1px solid ${C.line}` }}>
      <div className="flex h-10 shrink-0 items-center gap-0.5 px-2" style={{ borderBottom: `1px solid ${C.line}`, color: C.muted }}>
        <button type="button" onClick={onUndo} disabled={!canUndo} className={toolBtn} title="Undo (Ctrl+Z)">
          <Undo2 className="h-4 w-4" />
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo} className={toolBtn} title="Redo (Ctrl+Shift+Z)">
          <Redo2 className="h-4 w-4" />
        </button>
        <span className="mx-1.5 h-5 w-px" style={{ background: C.line }} />
        <button type="button" onClick={onSplit} className={toolBtn} title="Split (S)">
          <Scissors className="h-4 w-4" />
        </button>
        <button type="button" onClick={onDuplicate} disabled={!sel || sel.kind === "audio"} className={toolBtn} title="Duplicate (Ctrl+D)">
          <Copy className="h-4 w-4" />
        </button>
        <button type="button" onClick={onDelete} disabled={!sel} className={toolBtn} title="Delete">
          <Trash2 className="h-4 w-4" />
        </button>
        <span className="mx-1.5 h-5 w-px" style={{ background: C.line }} />
        <button type="button" onClick={onAddText} className="flex h-8 items-center gap-1.5 rounded-md px-2 font-semibold hover:bg-white/5" title="Add text">
          <Type className="h-4 w-4" />
          Text
        </button>
        <div className="ml-auto flex items-center gap-2">
          <ZoomOut className="h-4 w-4" />
          <input type="range" min={20} max={240} value={pps} onChange={(e) => onPps(Number(e.target.value))} className="w-32" style={{ accentColor: C.accent }} />
          <ZoomIn className="h-4 w-4" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="relative flex" style={{ width: width + GUTTER }}>
          <div className="sticky left-0 z-20 shrink-0" style={{ width: GUTTER, background: C.panel, borderRight: `1px solid ${C.line}` }}>
            <div className="h-6" />
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex items-center justify-center" style={{ height: ROW_H, color: C.soft }}>
                <Type className="h-3.5 w-3.5" />
              </div>
            ))}
            <div className="flex h-16 items-center justify-center" style={{ color: C.soft }}>
              <Film className="h-4 w-4" />
            </div>
            <div className="flex h-10 items-center justify-center" style={{ color: C.soft }}>
              <Music className="h-4 w-4" />
            </div>
          </div>

          <div ref={area} className="relative" style={{ width }} onPointerDown={(e) => e.target === e.currentTarget && onSel(null)}>
            <div className="relative h-6 cursor-pointer select-none" style={{ borderBottom: `1px solid ${C.line}` }} onPointerDown={seekFrom}>
              {ticks.map((s) => (
                <div key={s} className="absolute top-0 h-full" style={{ left: px(s) }}>
                  <div className="h-2 w-px" style={{ background: C.soft }} />
                  <span className="absolute left-1 top-1 font-mono text-[10px]" style={{ color: C.soft }}>
                    {fmt(s).slice(0, 5)}
                  </span>
                </div>
              ))}
            </div>

            {Array.from({ length: rows }, (_, i) => rows - 1 - i).map((r) => (
              <div key={r} className="relative" style={{ height: ROW_H }}>
                {tl.texts
                  .filter((x) => x.row === r)
                  .map((x) => {
                    const on = sel?.kind === "text" && sel.id === x.id;
                    return (
                      <div
                        key={x.id}
                        onPointerDown={(e) => dragText(e, x, "move")}
                        className="absolute top-[3px] flex h-[24px] cursor-grab items-center overflow-hidden rounded px-2 text-[11.5px] text-white active:cursor-grabbing"
                        style={{ left: px(x.start), width: Math.max(8, px(x.end - x.start)), background: C.textClip, outline: on ? "2px solid #fff" : undefined }}
                      >
                        <span className="truncate">{x.text}</span>
                        {x.keys?.map((k) => (
                          <Diamond key={k.t} className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-white" fill="#fff" style={{ left: px(k.t) - 5 }} />
                        ))}
                        {on && <Handles onLeft={(e) => dragText(e, x, "left")} onRight={(e) => dragText(e, x, "right")} />}
                      </div>
                    );
                  })}
              </div>
            ))}

            <div className="relative h-16">
              {tl.clips.map((c, i) => {
                const on = sel?.kind === "clip" && sel.id === c.id;
                const w = px(clipLen(c));
                return (
                  <div
                    key={c.id}
                    onPointerDown={(e) => dragClip(e, c, "move")}
                    className="absolute top-1 flex h-14 cursor-grab flex-col overflow-hidden rounded-md active:cursor-grabbing"
                    style={{ left: px(starts[i]) + 1, width: Math.max(10, w - 2), background: C.video, outline: on ? "2px solid #fff" : undefined }}
                  >
                    <div className="flex h-[18px] shrink-0 items-center gap-1.5 px-1.5 text-[10.5px] text-white/90">
                      {c.speed !== 1 && <span className="rounded bg-black/30 px-1">{c.speed}x</span>}
                      <span className="truncate">{c.name}</span>
                      <span className="ml-auto shrink-0 font-mono">{fmt(clipLen(c)).slice(0, 5)}</span>
                    </div>
                    <ClipStrip clip={c} width={w} />
                    {c.keys?.map((k) => (
                      <Diamond key={k.t} className="absolute bottom-1 h-3 w-3 text-white" fill="#fff" style={{ left: px(k.t) - 6 }} />
                    ))}
                    {on && <Handles onLeft={(e) => dragClip(e, c, "left")} onRight={(e) => dragClip(e, c, "right")} />}
                  </div>
                );
              })}
              {insertAt !== null && <div className="absolute top-0 h-16 w-0.5 bg-white" style={{ left: px(insertAt < tl.clips.length ? starts[insertAt] : starts.length ? starts[starts.length - 1] + clipLen(tl.clips[tl.clips.length - 1]) : 0) }} />}
              {tl.clips.length === 0 && (
                <div className="absolute inset-y-1 left-1 flex w-64 items-center justify-center rounded-md text-[12px]" style={{ border: `1px dashed ${C.line}`, color: C.soft }}>
                  Add media from the bin
                </div>
              )}
            </div>

            <div className="relative h-10">
              {tl.audio.map((a) => {
                const on = sel?.kind === "audio" && sel.id === a.id;
                return (
                  <div
                    key={a.id}
                    onPointerDown={(e) => dragAudio(e, a, "move")}
                    className="absolute top-1 flex h-8 cursor-grab items-center overflow-hidden rounded-md px-2 text-[11px] text-white/90 active:cursor-grabbing"
                    style={{ left: px(a.start), width: Math.max(8, px(a.out - a.in)), background: C.audio, outline: on ? "2px solid #fff" : undefined }}
                  >
                    <Music className="mr-1 h-3 w-3 shrink-0" />
                    <span className="truncate">{a.name}</span>
                    <Wave />
                    {on && <Handles onLeft={(e) => dragAudio(e, a, "left")} onRight={(e) => dragAudio(e, a, "right")} />}
                  </div>
                );
              })}
            </div>

            <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-white" style={{ left: px(time) }}>
              <span className="pointer-events-auto absolute -left-[6px] top-0 h-3.5 w-3.5 cursor-ew-resize rounded-b-full bg-white" onPointerDown={seekFrom} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Handles({ onLeft, onRight }: { onLeft: (e: React.PointerEvent) => void; onRight: (e: React.PointerEvent) => void }) {
  return (
    <>
      <span onPointerDown={onLeft} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/90" />
      <span onPointerDown={onRight} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/90" />
    </>
  );
}

function Wave() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-3 items-end gap-px px-1 opacity-50">
      {Array.from({ length: 60 }, (_, i) => (
        <span key={i} className="w-px flex-1 bg-white" style={{ height: `${25 + Math.abs(Math.sin(i * 1.7)) * 75}%` }} />
      ))}
    </div>
  );
}

/** Thumbnail strip: one frame every ~64px, capped so long clips stay light. */
function ClipStrip({ clip, width }: { clip: VClip; width: number }) {
  const n = Math.max(1, Math.min(8, Math.floor(width / 64)));
  if (clip.kind === "placeholder") return <div className="relative flex-1">{<AvatarPlaceholder tones={clip.tones ?? AVATAR_TONES[0]} />}</div>;
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {Array.from({ length: n }, (_, i) => {
        const at = clip.in + ((clip.out - clip.in) * (i + 0.5)) / n;
        return clip.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={`/api/media/${clip.mediaId}`} alt="" className="h-full min-w-0 flex-1 object-cover" />
        ) : (
          <video key={i} src={`/api/media/${clip.mediaId}#t=${at.toFixed(1)}`} muted preload="metadata" className="pointer-events-none h-full min-w-0 flex-1 object-cover" />
        );
      })}
      {clip.kind === "image" && <ImageIcon className="absolute bottom-1 right-1 h-3 w-3 text-white/70" />}
    </div>
  );
}
