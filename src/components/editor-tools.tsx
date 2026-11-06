"use client";
import { MediaVideo } from "@/components/media-video";
import { previewOf } from "@/lib/media-preview";
import dynamic from "next/dynamic";

import { memo, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";


import { ArrowLeftRight, Check, ClipboardPaste, Copy, Diamond, Film, FolderOpen, ListOrdered, Loader2, Magnet, Music, Pause, Play, Plus, Redo2, Scissors, SlidersHorizontal, Smartphone, Undo2, Volume1, Volume2, VolumeX, Trash2, Type, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { frameAt } from "@/lib/filmstrip";
import { waveform } from "@/lib/waveform";



import { ADJUST_ROWS, type Adjust, type AdjustRow, type Motion, NO_ADJUST, fullAdjust, isAdjusted, keyAt, motionAt, moveKey, panBy, setMotion, speedOf, toggleKey, videoStyle } from "@/lib/adjust";
import { audioLength, pieceEnd, refSoundSrc, rowBounds, rowOf, soundName, soundPieces, soundRows } from "@/lib/sound";
import type { Song } from "@/app/api/songs/route";
import { type Seg, clipGroup, clipSrc, demoClips, fileAt, pieceAdjust, segAt, showsAt, videoLength, pieceSpans, relAt } from "@/lib/edit";

import { round1, uid, uploadFile } from "@/lib/client";
import { fmtTime, type DemoClip, type Part, type Reference, type SoundPiece, type Run, type TextLayer } from "@/lib/types";




import { SegmentVideos, SyncedAudio, TextOverlay, WarmthFilter, claimPlayback, soundAt, usePlaybackClaims } from "@/components/run-preview";




function magnet(points: number[], tol: number) {
  let stuck: number | null = null;
  return (v: number): number | null => {
    if (stuck !== null && Math.abs(v - stuck) <= tol * 2.2) return stuck;
    stuck = points.reduce<number | null>((best, q) => (Math.abs(q - v) <= tol && (best === null || Math.abs(q - v) < Math.abs(best - v)) ? q : best), null);
    return stuck;
  };
}

const optionBtn = (on: boolean) =>
  `flex items-center gap-1.5 rounded-lg border px-3.5 py-2.5 text-[14px] font-semibold ${on ? "border-accent bg-accent-tint text-accent" : "border-line-strong bg-panel text-text hover:border-accent hover:text-accent"}`;

export function ClipEditor({ seg, version, texts, cover, overlay, side, firstTextPlaceholder = "Text", onRegenerateFirst, onParts, onSplit, onAdjust, onPieceAdjust, onPatch, onAdd, onRemove, onApplyAll }: {
  /** Cut makes a new clip from the rest (unused since 2026-11-03: Cut splits this clip into pieces again). */
  onSplit?: (file: number) => void;
  /** One piece's own settings (a Cut clip): everything but Speed. */
  onPieceAdjust?: (partId: string, a: Partial<Adjust>) => void;
  /** Extra controls in the right column, under the settings. */
  side?: React.ReactNode;
  /** The first text row gets a Regenerate icon (the hook's line); called with that text's id. */
  onRegenerateFirst?: (id: string) => Promise<void>;
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
    if (video) video.volume = fullAdjust(pieceAdjust(seg, piece.current)).volume / 100;
  }, [seg, version, playing]);
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
  // Only the pieces' places count (a piece's own look or volume changing must not reset selection, playhead or Undo).
  const historyKeyFor = (parts: Part[]) => JSON.stringify([seg.src, version, parts.map((p) => [p.id, p.start, p.end])]);
  const partsKey = historyKeyFor(seg.parts);
  const [historyKey, setHistoryKey] = useState(partsKey);
  if (historyKey !== partsKey) {
    // Another editor or a replacement file invalidates this editor's local Cut history.
    setHistoryKey(partsKey);
    setUndo([]);
    setPick(null);
    setDraft(null);
    setPlaying(false);
    setT(0);
  }
  useEffect(() => {
    if (playing) return;
    const here = fileAt(seg, Math.min(t, seg.len));
    piece.current = here.i;
    if (vref.current && Math.abs(vref.current.currentTime - here.file) > 0.04) vref.current.currentTime = here.file;
  }, [seg, t, playing]);
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
  // Play the pieces back to back (skipping what was cut away) and move the playhead smoothly. Plays once: after the
  // last piece the playhead goes back to the start and stays paused.
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
        if (i === s.parts.length - 1) {
          v.pause();
          piece.current = 0;
          v.currentTime = s.parts[0].start;
          setT(0);
          setPlaying(false);
          return;
        }
        i += 1;
        v.currentTime = s.parts[i].start;
        v.volume = fullAdjust(pieceAdjust(s, i)).volume / 100;
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
    setHistoryKey(historyKeyFor(next));
    setUndo((u) => [...u.slice(-49), seg.parts]);
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
  // Settings belong to one piece of a Cut clip: the selected one, else the one at the playhead (Speed stays the
  // clip's). A clip of one piece keeps its settings on the clip itself.
  const pickedIndex = seg.parts.findIndex((x) => x.id === picked);
  const target = seg.parts.length > 1 ? (pickedIndex >= 0 ? pickedIndex : here.i) : 0;
  const adj = pieceAdjust(seg, target);
  const shown = pieceAdjust(seg, here.i);
  // Fullscreen plays on its own clock (fullT): its look and sound are that piece's.
  const fullShown = pieceAdjust(seg, fileAt(seg, Math.max(0, Math.min(seg.len, fullT))).i);
  const setAdj = (a: Partial<Adjust>) => {
    if ((seg.parts.length < 2 && !seg.parts[0]?.adjust) || !onPieceAdjust) return onAdjust(a);
    if (speedOf(a) !== speed) return onAdjust({ ...seg.adjust, speed: speedOf(a) });
    const own: Partial<Adjust> = { ...fullAdjust(a) };
    delete own.speed;
    onPieceAdjust(seg.parts[target].id, own);
  };
  const look = videoStyle(shown, fileT);
  const motion = motionAt(shown, fileT);
  const zoomed = motion.zoom > 0;
  const allKeys = fullAdjust(adj).keys.slice().sort((x, y) => x.t - y.t);
  function panStart(e: React.PointerEvent<HTMLDivElement>) {
    panned.current = false;
    if (!zoomed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const at = fileT;
    const from = motionAt(adj, at);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!panned.current && Math.hypot(dx, dy) < 4) return;
      if (!panned.current) setPlaying(false);
      panned.current = true;
      setAdj(setMotion(adj, at, panBy(from.zoom, dx, dy, rect.width, rect.height, from)));
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
  // To the millisecond, like the clip itself: an added text covers exactly this clip.
  const span: [number, number] = [Math.round(offset * 1000) / 1000, Math.round((offset + len) * 1000) / 1000];

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
                  <WarmthFilter adjust={shown} />
                  <MediaVideo ref={vref} key={`${seg.src}|${version ?? ""}`} src={seg.id === "hook" ? seg.src : previewOf(seg.src)} muted={!playing} playsInline onLoadedMetadata={() => seek(0)} className="absolute inset-0 h-full w-full object-cover" style={look} />
                  {/* One caption at a time at a boundary (end is exclusive), except the clip's very end shows its last caption. */}
                  {local.filter((x) => x.text.trim() && (showsAt(x, t) || (x.end >= len - 0.001 && t >= len - 0.001 && t >= x.start - 0.001))).map((x) => <TextOverlay key={x.id} x={x} onPatch={onPatch} />)}
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
              src={seg.src ?? undefined}
              speed={speed}
              pieces={seg.parts.map((x, i) => ({ id: x.id, at: spans[i].at, len: spans[i].len, start: x.start, end: x.end }))}
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
                setPlaying(false);
                const f = Math.round(fileT * 1000) / 1000;
                if (onSplit) return onSplit(f);
                // Two pieces side by side in this clip; nothing is removed or moved. The new piece starts with the
                // same settings; after that each piece's settings are its own.
                // Only a split: both pieces stay as they were, nothing is selected or greyed out (founder 2026-10-30).
                const second: Part = { id: uid(), start: f, end: herePart.end, ...(herePart.adjust ? { adjust: herePart.adjust } : {}) };
                change([...seg.parts.slice(0, here.i), { ...herePart, end: f }, second, ...seg.parts.slice(here.i + 1)]);
                setPick(null);
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
              onKeyMove={(i, rel) => setAdj(moveKey(adj, i, fileAt(seg, Math.max(0, Math.min(len, rel))).file))}
              canUndo={undo.length > 0}
              onUndo={() => {
                const last = undo[undo.length - 1];
                if (!last) return;
                setHistoryKey(historyKeyFor(last));
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
            key={seg.parts[target]?.id}
            value={adj}
            disabled={!live}
            onChange={setAdj}
            motion={motionAt(adj, fileT)}
            keyOn={keyAt(adj, fileT) >= 0}
            onMotion={(patch) => {
              setPlaying(false);
              setAdj(setMotion(adj, fileT, patch));
            }}
            onKey={() => {
              setPlaying(false);
              setAdj(toggleKey(adj, fileT));
            }}
          />
          {side}
        </div>
      </div>

      {mine.length > 0 ? (
        <div className="space-y-2">
          {mine.map((x, i) => (
            <TextRow key={x.id} t={x} placeholder={i === 0 ? firstTextPlaceholder : "More text"} onRegenerate={i === 0 && onRegenerateFirst ? () => onRegenerateFirst(x.id) : undefined} onPatch={(patch) => onPatch(x.id, patch)} onAdd={() => onAdd(x.id, span)} onRemove={() => onRemove(x.id)} onApplyAll={onApplyAll && texts.length > 1 ? () => onApplyAll(x.id) : undefined} />
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
            <WarmthFilter adjust={fullShown} />
            <TrimmedVideo src={seg.id === "hook" ? seg.src : previewOf(seg.src)} parts={seg.parts} rate={speed} adjust={fullShown} onTime={setFullT} />
            {local.filter((x) => x.text.trim() && showsAt(x, fullT)).map((x) => <TextOverlay key={x.id} x={x} onPatch={onPatch} />)}
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
  /** Everything selected when several are ("t:<id>" / "c:<clip>:<piece>"); empty otherwise. */
  selKeys: Set<string>;
  /** add: Ctrl/Cmd/Shift was held (the item joins or leaves the selection). */
  onSelectClip: (segId: string, partId: string, add?: boolean) => void;
  onSelectText: (id: string, add?: boolean) => void;
  /** A sound Ctrl/Cmd/Shift-clicked: it joins or leaves the selection. */
  onSelectSound: (id: string) => void;
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

type PlaybackClock = { get: () => number; set: (time: number) => void; subscribe: (listener: () => void) => () => void };
function createPlaybackClock(): PlaybackClock {
  let time = 0;
  const listeners = new Set<() => void>();
  return { get: () => time, set: next => { if (next === time) return; time = next; listeners.forEach(fn => fn()); },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
function usePlaybackTime(playback: PlaybackClock) {
  return useSyncExternalStore(playback.subscribe, playback.get, playback.get);
}

function WholePlayer({ segs, texts, pieces, selected, side, onSelect, onTrim, onMove, onSplit, onAdd, onDelete, onUndo, onRedo, onCopy, onPaste, onCutSel, onSelectAll, onTrimTo, onZoom, onSplitAll, claim = "whole", edit, toolbar, compact = false, autoFocus = false }: {
  segs: Seg[];
  /** Shown next to the video (the selected sound's card, or the editor's settings for the selection). */
  side: React.ReactNode | ((playback: PlaybackClock) => React.ReactNode);
  /** Playback id (one player plays at a time). */
  claim?: string;
  /** Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A (the full editor). */
  onCopy?: () => void;
  onPaste?: (time: number) => void;
  onCutSel?: () => void;
  onSelectAll?: () => void;
  /** Q / W: delete before / after the playhead. */
  onTrimTo?: (time: number, side: "left" | "right") => void;
  /** Ctrl + = / -: timeline zoom. */
  onZoom?: (dir: 1 | -1) => void;
  /** Ctrl + Shift + B: split everything under the playhead. */
  onSplitAll?: (time: number) => void;
  edit?: TimelineEdit;
  /** Replaces the Cut / + Sound buttons (the full editor's tools); gets the playhead time. */
  toolbar?: (time: () => number) => React.ReactNode;
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
  const total = Math.max(0.001, videoLength(segs));
  const [playback] = useState(createPlaybackClock);
  const setT = playback.set;
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
  // Plays once: at the end the playhead goes back to 0 and stays paused (looping made the restart lag).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      const next = playback.get() + dt;
      if (next >= total) {
        setT(0);
        setPlaying(false);
        return;
      }
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, playback, setT]);
  // Keyboard, like CapCut: Space play/pause, Delete / Backspace removes the selection, S / Ctrl+B split, Ctrl+C / X / V
  // copy, cut, paste, Ctrl+A select all, Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo, Left / Right one frame (Shift: 1 s),
  // Up / Down the previous / next cut, Home / End the start / end, Esc deselects (founder 2026-11-07).
  const keys = useRef({ playing, onSplit, onDelete, onUndo, onRedo, onSelect, onCopy, onPaste, onCutSel, onSelectAll, onTrimTo, onZoom, onSplitAll, segs });
  useEffect(() => {
    keys.current = { playing, onSplit, onDelete, onUndo, onRedo, onSelect, onCopy, onPaste, onCutSel, onSelectAll, onTrimTo, onZoom, onSplitAll, segs };
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
      const k = { ...keys.current, time: Math.min(playback.get(), total - 0.001) };
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === "Space") {
        if (!k.playing) claimPlayback(claim);
        setPlaying(!k.playing);
      } else if (e.key === "Delete" || e.key === "Backspace") k.onDelete();
      else if (mod && e.shiftKey && e.key.toLowerCase() === "b" && k.onSplitAll) {
        setPlaying(false);
        k.onSplitAll(k.time);
      }
      else if ((!mod && e.key.toLowerCase() === "s") || (mod && e.key.toLowerCase() === "b")) {
        setPlaying(false);
        k.onSplit(k.time);
      } else if (mod && e.key.toLowerCase() === "c" && k.onCopy) k.onCopy();
      else if (mod && e.key.toLowerCase() === "v" && k.onPaste) {
        setPlaying(false);
        k.onPaste(k.time);
      } else if (!mod && (e.key.toLowerCase() === "q" || e.key.toLowerCase() === "w") && k.onTrimTo) {
        setPlaying(false);
        k.onTrimTo(k.time, e.key.toLowerCase() === "q" ? "left" : "right");
      } else if (mod && (e.key === "=" || e.key === "+" || e.key === "-") && k.onZoom) k.onZoom(e.key === "-" ? -1 : 1);
      else if (mod && e.key.toLowerCase() === "x" && k.onCutSel) k.onCutSel();
      else if (mod && e.key.toLowerCase() === "a" && k.onSelectAll) k.onSelectAll();
      else if (mod && e.key.toLowerCase() === "z") (e.shiftKey ? k.onRedo : k.onUndo)();
      else if (mod && e.key.toLowerCase() === "y") k.onRedo();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        setPlaying(false);
        // One frame (30 fps), like CapCut; Shift: one second.
        const step = (e.shiftKey ? 1 : 1 / 30) * (e.key === "ArrowLeft" ? -1 : 1);
        setT(Math.max(0, Math.min(total - 0.01, k.time + step)));
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        setPlaying(false);
        // Every cut: clip edges and the split points inside a clip (S / Ctrl+B).
        const cuts = [0, ...k.segs.flatMap((g) => [g.offset, ...pieceSpans(g).map((p) => g.offset + p.at), g.offset + g.len]), total - 0.01];
        const t = e.key === "ArrowUp" ? Math.max(0, ...cuts.filter((c) => c < k.time - 0.001)) : Math.min(total - 0.01, ...cuts.filter((c) => c > k.time + 0.001));
        setT(t);
      } else if (e.key === "Home" || e.key === "End") {
        setPlaying(false);
        setT(e.key === "Home" ? 0 : total - 0.01);
      } else if (e.key === "Escape") k.onSelect(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [total, claim, playback, setT]);

  const focusIn = (e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).closest("input, textarea, select, button, a, [contenteditable]")) scope.current?.focus({ preventScroll: true });
  };
  const videoBox = (cls: string, style?: React.CSSProperties) => <WholeMedia playback={playback} segs={segs} texts={texts} playing={playing} onTextMove={edit?.onTextMove} onTextPick={edit?.onSelectText} cls={cls} style={style} />;
  const sideNode = typeof side === "function" ? side(playback) : side;
  const audio = <WholeAudio playback={playback} pieces={pieces} total={total} playing={playing} />;
  const controls = (
    <WholeControls
      segs={segs}
      texts={texts}
      pieces={pieces}
      selected={selected}
      total={total}
      playback={playback}
      playing={playing}
      edit={edit}
      toolbar={toolbar?.(() => Math.min(playback.get(), total - 0.001))}
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
        onSplit(Math.min(playback.get(), total - 0.001));
      }}
      onAdd={() => {
        setPlaying(false);
        onAdd(Math.min(playback.get(), total - 0.001));
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

function WholeMedia({ playback, segs, texts, playing, onTextMove, onTextPick, cls, style }: {
  playback: PlaybackClock; segs: Seg[]; texts: TextLayer[]; playing: boolean;
  onTextMove?: TimelineEdit["onTextMove"]; onTextPick?: TimelineEdit["onSelectText"]; cls: string; style?: React.CSSProperties;
}) {
  const time = Math.min(usePlaybackTime(playback), Math.max(0.001, videoLength(segs)) - 0.001);
  const hit = segAt(segs, time);
  const seg = hit ?? segs[segs.length - 1];
  const { file: at, i: piece } = fileAt(seg, time - seg.offset);
  return (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-[#14121f] [container-type:size] ${cls}`} style={style}>
      {!hit ? null : seg.src ? (
        <SegmentVideos segs={segs} seg={seg} at={at} piece={piece} playing={playing} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold text-white/40">{seg.id === "hook" ? "Your hook" : "Your demo"}</div>
      )}
      {texts.filter((x) => x.text.trim() && showsAt(x, time)).map((x) => <TextOverlay key={x.id} x={x} onPatch={onTextMove} onPick={onTextPick} />)}
    </div>
  );
}

function WholeAudio({ playback, pieces, total, playing }: { playback: PlaybackClock; pieces: SoundPiece[]; total: number; playing: boolean }) {
  const time = Math.min(usePlaybackTime(playback), total - 0.001);
  return <>{pieces.map((p, i) => <SyncedAudio key={p.id} src={p.src} at={soundAt({ ...p, end: pieceEnd(pieces, i, total) }, time)} playing={playing} volume={p.volume / 100} />)}</>;
}

/** A row of frames from `src` at these file times, filling its parent (behind the label). */
const Filmstrip = memo(function Filmstrip({ src, times, frame }: { src: string; times: number[]; frame: number }) {
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
}, (a,b) => a.src === b.src && a.frame === b.frame && a.times.length === b.times.length && a.times.every((t,i) => t === b.times[i]));

/** Player bar for the whole video, three lines like CapCut: the clips, the texts, the sound line (click a sound, ✂ split it, drag its ends to trim, + add another). */
function WholeControls({ segs, texts, pieces, selected, total, playback, playing, onPlay, onSeek, onSelect, onTrim, onMove, onSplit, onAdd, edit, toolbar }: {
  edit?: TimelineEdit;
  toolbar?: React.ReactNode;
  segs: Seg[];
  texts: TextLayer[];
  pieces: SoundPiece[];
  selected: string | null;
  total: number;
  playback: PlaybackClock;
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
  // Editor: a clip piece being trimmed (timeline seconds), saved on release.
  // The trimmed piece keeps its start on the timeline and everything after it slides along (no gap, like CapCut's main track).
  const [clipDraft, setClipDraft] = useState<{ key: string; seg: string; lo: number; cutL: number; cutR: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
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
    // Ctrl/Cmd/Shift-click adds it to (or takes it out of) the selection, like CapCut; no seek, no drag.
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      edit.onSelectClip(x.id, partId, true);
      return;
    }
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
    const snapEnd = magnet([Math.min(playback.get(), total - 0.001), ...texts.flatMap((x) => [x.start, x.end]), ...pieces.flatMap((q, j) => [q.at, pieceEnd(pieces, j, total)])], (12 / rect.width) * width);
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
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.stopPropagation();
      edit.onSelectText(x.id, true);
      return;
    }
    edit.onSelectText(x.id);
    dragTextBar(e, rect, total, x, mode, [0, total, Math.min(playback.get(), total - 0.001), ...segs.map((g) => g.offset), ...texts.filter((o) => o.id !== x.id).flatMap((o) => [o.start, o.end])], edit.onTextTiming, setGuide, edit.onTextBegin, width);
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
    const points = [0, total, Math.min(playback.get(), total - 0.001), lo, hi, ...segs.map((x) => x.offset), ...pieces.flatMap((q, j) => (j === i ? [] : [q.at, pieceEnd(pieces, j, total)]))];
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
    const points = [0, total, Math.min(playback.get(), total - 0.001), lo, hi, ...segs.map((x) => x.offset), ...pieces.flatMap((q, j) => (j === i ? [] : [q.at, pieceEnd(pieces, j, total)]))];
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
      <WholeTransport playback={playback} total={total} playing={playing} pieces={pieces} onPlay={onPlay} onSplit={onSplit} onAdd={onAdd} toolbar={toolbar} />
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
                const on = edit.selClip === key || edit.selKeys.has(`c:${key}`);
                // Trim handles only on a single selection.
                const handles = edit.selClip === key && !edit.selKeys.size;
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
                    aria-label={`Clip: ${x.parts.length > 1 ? pieceName(name, pi) : name}`}
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
                      <span className="truncate">{x.parts.length > 1 ? pieceName(name, pi) : name}</span>
                      {x.src && <span className="shrink-0 font-semibold tabular-nums text-white/75">{fmtTime(hi - lo)}</span>}
                    </span>
                    {handles && x.editable && (
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
        <div className="relative h-7 cursor-pointer overflow-hidden rounded-md text-[10.5px] font-bold" onPointerDown={seek}>
          {segs.map((x, i) => (
            <div
              key={x.id}
              title={x.label}
              className={`absolute inset-y-0 flex min-w-0 items-center border-white px-1.5 ${i ? "border-l-2" : ""} ${x.id === "hook" ? "bg-[#221d33] text-white" : !x.src ? "bg-hover text-soft" : i % 2 ? "bg-[#dfdde9] text-text" : "bg-[#d2d0df] text-text"}`}
              style={{ left: pct(x.offset), width: pct(x.len) }}
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
                    aria-pressed={edit.selText === x.id || edit.selKeys.has(`t:${x.id}`)}
                    onPointerDown={(e) => dragText(e, x, "move")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); edit.onSelectText(x.id); }
                    }}
                    title="Drag to move. Drag the ends to make it longer or shorter."
                    className={`absolute inset-y-0 flex cursor-grab touch-none items-center gap-1 overflow-hidden rounded-md bg-texttrack-tint px-3.5 text-[10.5px] font-semibold text-texttrack outline-none active:cursor-grabbing ${edit.selText === x.id || edit.selKeys.has(`t:${x.id}`) ? "ring-2 ring-inset ring-texttrack" : ""}`}
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
            const on = p.id === selected || Boolean(edit?.selKeys.has(`s:${p.id}`));
            // Trim handles only on a single selection.
            const single = p.id === selected;
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
                  if (edit && (e.ctrlKey || e.metaKey || e.shiftKey)) return edit.onSelectSound(p.id);
                  onSelect(p.id);
                  moveSound(e, i);
                }}
                className={`absolute inset-y-0 flex cursor-grab touch-none items-center gap-1.5 overflow-hidden rounded-md px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-[10.5px] font-bold active:cursor-grabbing ${joinL ? "rounded-l-none" : ""} ${joinR ? "rounded-r-none border-r border-white" : ""} ${on ? "bg-soundtrack text-white" : "bg-soundtrack-tint text-soundtrack hover:bg-[#f3cfe6]"}`}
                style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }}
              >
                <Music className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{p.name}</span>
                {single && (
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
        <WholePlayhead playback={playback} total={total} width={width} playing={playing} scroller={scroller} />
        {guide !== null && <div className="pointer-events-none absolute -bottom-1 -top-1 z-30 w-px -translate-x-1/2 bg-accent" style={{ left: pct(guide) }} />}
      </div>
      </div>
    </div>
  );
}

function WholeTransport({ playback, total, playing, pieces, onPlay, onSplit, onAdd, toolbar }: {
  playback: PlaybackClock; total: number; playing: boolean; pieces: SoundPiece[];
  onPlay: () => void; onSplit: () => void; onAdd: () => void; toolbar?: React.ReactNode;
}) {
  const t = Math.min(usePlaybackTime(playback), total - 0.001);
  const underPlayhead = pieces.some((p, i) => t > p.at + 0.25 && t < pieceEnd(pieces, i, total) - 0.25);
  return (
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
  );
}
function WholePlayhead({ playback, total, width, playing, scroller }: {
  playback: PlaybackClock; total: number; width: number; playing: boolean; scroller: React.RefObject<HTMLDivElement | null>;
}) {
  const t = Math.min(usePlaybackTime(playback), total - 0.001);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing || el.scrollWidth <= el.clientWidth) return;
    const x = (t / width) * el.scrollWidth;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollTo({ left: x - 24 });
  }, [t, playing, width, scroller]);
  return <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-0.5 rounded bg-text" style={{ left: `${(Math.max(0, Math.min(width, t)) / width) * 100}%` }} />;
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
export function SoundStep({ run, source, segs, texts, videoLen, onPieces }: {
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
export function VideoEditor({ run, source, segs, texts, videoLen, onClose, onRestore, onParts, onPieceAdjust, onDeleteClip, onDeleteMany, onAddVideos, onInsertClip, onMoveClip, onShiftClip, onCloseGaps, onAdjust, onPatchText, onAddText, onRemoveText, onApplyAll, onPieces }: {
  run: Run;
  source: Reference | null;
  segs: Seg[];
  texts: TextLayer[];
  videoLen: number;
  onClose: () => void;
  onRestore: (s: EditorSnap) => void;
  /** hold = keep the clips after it in place (magnet off). */
  onParts: (clipId: string, parts: Part[], hold?: boolean) => void;
  /** One piece's own settings in a Cut clip (everything but Speed). */
  onPieceAdjust: (clipId: string, partId: string, a: Partial<Adjust>) => void;
  onDeleteClip: (clipId: string, hold?: boolean) => void;
  /** Several selected texts and clip pieces deleted in one step (one save, one Undo). */
  onDeleteMany: (textIds: string[], pieces: { seg: string; part: string }[], hold?: boolean) => void;
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
  // Several selected at once, like CapCut (Ctrl/Cmd/Shift-click, Ctrl+A): "t:<text id>" / "c:<clip id>:<piece id>". The
  // last one picked is also `sel` (its settings show on the right). Empty when one thing or nothing is selected.
  const [multiKeys, setMulti] = useState<string[]>([]);
  /** Ends any selection (clip, text and group). */
  const clearSel = () => {
    setSel(null);
    setMulti([]);
  };
  const [zoom, setZoom] = useState(1);
  const editorRoot = useRef<HTMLDivElement>(null);
  // Ctrl/Cmd + scroll zooms the timeline, like CapCut (not the page).
  useEffect(() => {
    const el = editorRoot.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => (e.deltaY < 0 ? Math.min(8, z * 2) : Math.max(1, z / 2)));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  // Main track magnet (on by default, like CapCut): clips stay joined. Off: drag clips anywhere, shortening leaves space.
  const [magnet, setMagnet] = useState(() => !segs.some((s) => s.gap > 0));
  const [past, setPast] = useState<EditorSnap[]>([]);
  const [future, setFuture] = useState<EditorSnap[]>([]);
  const [uploading, setUploading] = useState(false);
  // Copied with Ctrl+C (or Copy): a text, or a clip piece (pasted as a new clip).
  // A group keeps each item's place relative to the group's start (`rel`, seconds); its clips stay in timeline order.
  type CopiedGroup = { kind: "group"; clips: Omit<DemoClip, "id">[]; texts: { t: TextLayer; rel: number }[]; sounds: { p: SoundPiece; rel: number; len: number }[] };
  const [copied, setCopied] = useState<{ kind: "text"; t: TextLayer } | { kind: "clip"; clip: Omit<DemoClip, "id"> } | CopiedGroup | null>(null);
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
    clearSel();
  };
  const redo = () => {
    const next = future[future.length - 1];
    if (!next) return;
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, snap()]);
    onRestore(next);
    clearSel();
  };
  type Sel = NonNullable<typeof sel>;
  const keyOf = (s: Sel) => (s.kind === "text" ? `t:${s.id}` : `c:${s.seg}:${s.part}`);
  const fromKey = (k: string): Sel => {
    const [kind, a, b] = k.split(":");
    return kind === "t" ? { kind: "text", id: a } : { kind: "clip", seg: a, part: b };
  };
  // A group (several selected): "c:<clip>:<piece>", "t:<text>", "s:<sound>". It counts only while no single sound is
  // selected on its own (a sound picked or added after it, whose selection clears `sel`, never leaves an old group to
  // delete; Codex 2026-11-07). Every plain selection or deselection ends it (clearSel, pick).
  const multi = multiKeys.length > 1 && !(sounds.choosing && sounds.pieces.length > 0) && (sel !== null || !sounds.selId) ? multiKeys : [];
  /** The group's members as one list, or the single selection as one item. */
  const current = () => (multi.length ? multi : sel ? [keyOf(sel)] : sounds.selId ? [`s:${sounds.selId}`] : []);
  /** Toggle key `k` in the selection (Ctrl/Cmd/Shift-click). The last clip or text in it shows its settings. */
  const toggle = (k: string) => {
    const base = current();
    const keys = base.includes(k) ? base.filter((x) => x !== k) : [...base, k];
    sounds.select(null);
    const last = [...keys].reverse().find((x) => !x.startsWith("s:"));
    if (keys.length === 1 && keys[0].startsWith("s:")) {
      setMulti([]);
      setSel(null);
      sounds.select(keys[0].slice(2));
      return;
    }
    setMulti(keys.length > 1 ? keys : []);
    setSel(last ? fromKey(last) : null);
  };
  /** Select `next`; with `add` (Ctrl/Cmd/Shift held) it joins or leaves the selection instead, like CapCut. */
  const pick = (next: typeof sel, add = false) => {
    if (add && next) return toggle(keyOf(next));
    sounds.select(null);
    setMulti([]);
    setSel(next);
  };
  /** Ctrl+A: every clip piece, text and sound. */
  const selectAll = () => {
    const keys = [...segs.filter((s) => s.src).flatMap((s) => s.parts.map((p) => `c:${s.id}:${p.id}`)), ...texts.map((t) => `t:${t.id}`), ...sounds.pieces.map((p) => `s:${p.id}`)];
    sounds.select(null);
    setMulti(keys.length > 1 ? keys : []);
    const first = keys.find((x) => !x.startsWith("s:"));
    setSel(first ? fromKey(first) : null);
    if (keys.length === 1 && keys[0].startsWith("s:")) sounds.select(keys[0].slice(2));
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
    // Two pieces in the same clip (founder 2026-11-03); the new one starts with the same settings, then its own.
    const second: Part = { id: uid(), start: r3(file), end: p.end, ...(p.adjust ? { adjust: p.adjust } : {}) };
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
  /** A clip piece as a new clip to paste (its file window, settings and source). */
  const clipCopy = (seg: Seg, partId: string): Omit<DemoClip, "id"> | null => {
    if (!seg.src || !seg.editable) return null;
    const part = seg.parts.find((x) => x.id === partId) ?? seg.parts[0];
    const from = demoClips(run).find((c) => c.id === seg.id);
    const name = seg.id === "hook" ? "Hook" : (from?.label ?? "Clip");
    return { label: `${name} copy`, ...(from?.mediaId ? { mediaId: from.mediaId } : { src: seg.src }), name: from?.name ?? name, seconds: seg.seconds, start: part.start, end: part.end, adjust: seg.adjust };
  };
  const copy = () => {
    if (multi.length > 1) {
      // The group: clips in timeline order, texts and sounds by their offset from the group's start.
      const clips = multi.flatMap((k) => {
        const x = fromKey(k);
        if (x.kind !== "clip" || k.startsWith("s:")) return [];
        const seg = segs.find((g) => g.id === x.seg);
        const i = seg ? seg.parts.findIndex((p) => p.id === x.part) : -1;
        return seg && i >= 0 ? [{ lo: seg.offset + pieceSpans(seg)[i].at, seg, part: x.part }] : [];
      }).sort((a, b) => a.lo - b.lo);
      const ts = multi.flatMap((k) => (k.startsWith("t:") ? texts.filter((t) => t.id === k.slice(2)) : []));
      const ss = multi.flatMap((k) => {
        const i = sounds.pieces.findIndex((p) => `s:${p.id}` === k);
        return i >= 0 ? [{ p: sounds.pieces[i], end: pieceEnd(sounds.pieces, i, videoLen) }] : [];
      });
      const base = Math.min(...clips.map((c) => c.lo), ...ts.map((t) => t.start), ...ss.map((s) => s.p.at));
      if (!Number.isFinite(base)) return;
      setCopied({
        kind: "group",
        clips: clips.flatMap((c) => clipCopy(c.seg, c.part) ?? []),
        texts: ts.map((t) => ({ t, rel: t.start - base })),
        sounds: ss.map((s) => ({ p: s.p, rel: s.p.at - base, len: s.end - s.p.at })),
      });
      return;
    }
    if (selText) setCopied({ kind: "text", t: selText });
    else if (selSeg && sel?.kind === "clip") {
      const clip = clipCopy(selSeg, sel.part);
      if (clip) setCopied({ kind: "clip", clip });
    }
  };
  /** Paste at the playhead: a text keeps its look and length; a clip goes in at the nearest clip edge. */
  const paste = (time: number) => {
    if (!copied) return;
    remember();
    if (copied.kind === "group") {
      // Clips go in at the nearest clip edge, in order; texts and sounds keep their place from there (or from the
      // playhead when the group has no clips).
      let anchor = time;
      if (copied.clips.length) {
        const at = insertIndex(time);
        const next = demoClips(run)[at];
        anchor = next ? (segs.find((g) => g.id === next.id)?.offset ?? videoLen) : videoLen;
        copied.clips.forEach((c, i) => onInsertClip({ ...c, id: uid() }, at + i));
      }
      for (const { t, rel } of copied.texts) {
        const at = r3(anchor + rel);
        onAddText(null, [at, r3(at + (t.end - t.start))], t.text, t);
      }
      if (copied.sounds.length) {
        // Their own new row, so they never cut into the sounds already there.
        const row = Math.max(-1, ...sounds.pieces.map(rowOf)) + 1;
        onPieces([...sounds.pieces, ...copied.sounds.map(({ p, rel, len }) => ({ ...p, id: uid(), at: r3(anchor + rel), end: r3(anchor + rel + len), row }))].sort((a, b) => a.at - b.at));
      }
      return;
    }
    if (copied.kind === "text") {
      const len = copied.t.end - copied.t.start;
      const at = r3(Math.max(0, Math.min(time, videoLen - 0.3)));
      onAddText(texts.some((x) => x.id === copied.t.id) ? copied.t.id : null, [at, r3(Math.min(videoLen, at + len))], copied.t.text, copied.t);
    } else onInsertClip({ ...copied.clip, id: uid() }, insertIndex(time));
  };
  const canCopy = Boolean(multi.length > 1 || selText || (selSeg?.src && selSeg.editable));

  /**
   * Ctrl+Shift+B: split everything under the playhead at once, the clip, every text and every sound there (Ctrl+B
   * splits only the selection or the clip).
   */
  const splitAll = (time: number) => {
    const seg = segs.find((x) => time >= x.offset && time < x.offset + x.len);
    let clipSplit: { id: string; parts: Part[] } | null = null;
    if (seg?.editable) {
      const { file, i } = fileAt(seg, time - seg.offset);
      const p = seg.parts[i];
      const sp = speedOf(seg.adjust);
      if ((file - p.start) / sp > 0.2 && (p.end - file) / sp > 0.2) {
        const second: Part = { id: uid(), start: r3(file), end: p.end, ...(p.adjust ? { adjust: p.adjust } : {}) };
        clipSplit = { id: seg.id, parts: [...seg.parts.slice(0, i), { ...p, end: r3(file) }, second, ...seg.parts.slice(i + 1)] };
      }
    }
    const ts = texts.filter((t) => time > t.start + 0.3 && time < t.end - 0.3);
    const under = sounds.pieces.map((p, i) => ({ p, end: pieceEnd(sounds.pieces, i, videoLen) })).filter(({ p, end }) => time > p.at + 0.25 && time < end - 0.25);
    if (!clipSplit && !ts.length && !under.length) return;
    remember();
    if (clipSplit) onParts(clipSplit.id, clipSplit.parts, !magnet);
    for (const t of ts) {
      onPatchText(t.id, { end: r3(time) });
      onAddText(t.id, [r3(time), t.end], t.text);
    }
    if (under.length) {
      const at = r3(time);
      const cut = new Set(under.map((u) => u.p.id));
      onPieces([...sounds.pieces.filter((p) => !cut.has(p.id)), ...under.flatMap(({ p, end }) => [{ ...p, end: at }, { ...p, id: uid(), at, end, start: round1(p.start + (at - p.at)) }])].sort((a, b) => a.at - b.at));
    }
    clearSel();
  };

  /**
   * Q / W, like CapCut: delete the part of the selected text, or of the selected clip piece (else the clip under the
   * playhead), before (Q) or after (W) the playhead. Each keeps at least 0.1 s.
   */
  const trimTo = (time: number, side: "left" | "right") => {
    if (multi.length > 1) return;
    if (selText) {
      if (side === "left" ? time <= selText.start || time >= selText.end - 0.1 : time >= selText.end || time <= selText.start + 0.1) return;
      remember();
      onPatchText(selText.id, side === "left" ? { start: r3(time) } : { end: r3(time) });
      return;
    }
    const seg = selSeg ?? segs.find((x) => time >= x.offset && time < x.offset + x.len);
    if (!seg || !seg.editable || !seg.src || time < seg.offset || time >= seg.offset + seg.len) return;
    const { file, i } = fileAt(seg, time - seg.offset);
    if (sel?.kind === "clip" && sel.seg === seg.id && seg.parts[i].id !== sel.part) return;
    const p = seg.parts[i];
    const sp = speedOf(seg.adjust);
    if (side === "left" ? (p.end - file) / sp < 0.1 || file <= p.start : (file - p.start) / sp < 0.1 || file >= p.end) return;
    remember();
    onParts(seg.id, seg.parts.map((x, j) => (j === i ? (side === "left" ? { ...x, start: r3(file) } : { ...x, end: r3(file) }) : x)), !magnet);
  };

  /** Delete the selection: a text, a clip piece (the last piece of a demo clip removes the clip), or a sound. */
  const remove = () => {
    if (multi.length > 1) {
      const picked = multi.filter((k) => !k.startsWith("s:")).map(fromKey);
      const gone = new Set(multi.filter((k) => k.startsWith("s:")).map((k) => k.slice(2)));
      remember();
      if (picked.length) onDeleteMany(picked.flatMap((x) => (x.kind === "text" ? [x.id] : [])), picked.flatMap((x) => (x.kind === "clip" ? [{ seg: x.seg, part: x.part }] : [])), !magnet);
      if (gone.size) onPieces(sounds.pieces.filter((p) => !gone.has(p.id)));
      clearSel();
      return;
    }
    if (selText) {
      remember();
      onRemoveText(selText.id);
      clearSel();
    } else if (selSeg && sel?.kind === "clip") {
      if (selSeg.parts.length > 1) {
        remember();
        onParts(selSeg.id, selSeg.parts.filter((x) => x.id !== sel.part), !magnet);
      } else if (selSeg.id !== "hook") {
        remember();
        onDeleteClip(selSeg.id, !magnet);
      }
      clearSel();
    } else if (sounds.selId) sounds.deleteSelected();
  };

  const side = (playback: PlaybackClock) => {
    const time = playback.get();
    if (selSeg) {
      const fileT = fileAt(selSeg, Math.max(0, Math.min(selSeg.len, time - selSeg.offset))).file;
      // The selected piece's own settings (Speed stays the clip's); a clip of one piece keeps them on the clip.
      const partAt = sel?.kind === "clip" ? Math.max(0, selSeg.parts.findIndex((x) => x.id === sel.part)) : 0;
      const selAdj = pieceAdjust(selSeg, partAt);
      const setPieceAdjust = (a: Partial<Adjust>) => {
        if (selSeg.parts.length < 2 && !selSeg.parts[0]?.adjust) return onAdjust(selSeg.id, a);
        if (speedOf(a) !== speedOf(selSeg.adjust)) return onAdjust(selSeg.id, { ...selSeg.adjust, speed: speedOf(a) });
        const own: Partial<Adjust> = { ...fullAdjust(a) };
        delete own.speed;
        onPieceAdjust(selSeg.id, selSeg.parts[partAt].id, own);
      };
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <Film className="h-4 w-4 text-soft" />
            {selSeg.id === "hook" ? "Hook" : selSeg.label}
          </div>
          <AdvancedSettings
            key={`${selSeg.id}|${partAt}`}
            defaultOpen
            playback={{ clock: playback, seg: selSeg, change: (a) => { rememberGesture(); setPieceAdjust(a); } }}
            value={selAdj}
            disabled={!selSeg.editable || !selSeg.src}
            onChange={(a) => { rememberGesture(); setPieceAdjust(a); }}
            motion={motionAt(selAdj, fileT)}
            keyOn={keyAt(selAdj, fileT) >= 0}
            onMotion={(patch) => { rememberGesture(); setPieceAdjust(setMotion(selAdj, fileT, patch)); }}
            onKey={() => { rememberGesture(); setPieceAdjust(toggleKey(selAdj, fileT)); }}
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
  const toolbar = (time: () => number) => (
    <>
      <button type="button" disabled={!past.length} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo" className={tool}>
        <Undo2 className="h-4 w-4" />
      </button>
      <button type="button" disabled={!future.length} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" className={tool}>
        <Redo2 className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <button type="button" onClick={() => cut(time())} title="Cut at the playhead (S)" className={tool}>
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
      <button type="button" disabled={!copied} onClick={() => paste(time())} title="Paste at the playhead (Ctrl+V)" aria-label="Paste" className={tool}>
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
            const at = insertIndex(time());
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
          const at = r3(Math.max(0, Math.min(time(), videoLen - 0.5)));
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
          clearSel();
          sounds.addAt(time());
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
    <div ref={editorRoot} role="dialog" aria-modal="true" aria-label="Edit video" onPointerDownCapture={() => { gestureRemembered.current = false; }} onKeyDownCapture={(e) => { if (!e.repeat) gestureRemembered.current = false; }} className="fixed inset-0 z-40 flex flex-col bg-panel">
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
              clearSel();
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
            onCutSel={() => {
              if (!canCopy) return;
              copy();
              remove();
            }}
            onSplitAll={splitAll}
            onSelectAll={selectAll}
            onTrimTo={trimTo}
            onZoom={(dir) => setZoom((z) => (dir > 0 ? Math.min(8, z * 2) : Math.max(1, z / 2)))}
            side={side}
            toolbar={toolbar}
            edit={{
              zoom,
              selClip: sel?.kind === "clip" ? `${sel.seg}:${sel.part}` : null,
              selText: sel?.kind === "text" ? sel.id : null,
              selKeys: new Set(multi),
              onSelectClip: (seg, part, add) => pick({ kind: "clip", seg, part }, add),
              onSelectText: (id, add) => pick({ kind: "text", id }, add),
              onSelectSound: (id) => toggle(`s:${id}`),
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
                clearSel();
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


/** How to film one demo clip: camera setup and steps in order. Its on-screen text is not shown: it goes on with the upload. */
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

/**
 * Step 5: one finished demo video, or "Plan it shot by shot": the stolen clip's demo shot for shot, one card per shot
 * with how to film it; its on-screen text goes on when the footage is uploaded. Every clip opens in the ClipEditor.
 */
export function DemoStep({ run, segs, copying = false, renderEditor, onFiles, onClips, onCheckLibrary, onUpload, onRename, onDelete, onSwap, onReset }: {
  /** My files, on its Demos tab: reuse a demo from another video. */
  onCheckLibrary: () => void;
  run: Run;
  segs: Seg[];
  /** The shot list is still being written; the copy lands as soon as it is. */
  copying?: boolean;
  renderEditor: (seg: Seg) => React.ReactNode;
  /** One video = one demo; several = clips in file-name order, filling shots still to film (from shot `from`) first. */
  onFiles: (files: File[], from?: string, landed?: (i: number) => void, signal?: AbortSignal) => Promise<void>;
  onClips: () => void;
  onUpload: (id: string, f: File) => Promise<void>;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  /** Move a clip to a new position (0-based). */
  onMove: (id: string, to: number) => void;
  /** Put clip `a` in clip `b`'s place; `b` and the clips after it move one to the right (a tile dropped on another). */
  onSwap: (a: string, b: string) => void;
  onReset: () => void;
}) {
  const clips = demoClips(run);
  // Reordering: the clip being dragged, and where it would land (index to insert before).
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [fileOver, setFileOver] = useState(false);
  /** Videos on their way up: shown right away from the file on this computer. */
  const [pending, setPending] = useState<{ url: string; name: string }[]>([]);
  const uploads = useRef<AbortController | null>(null);
  const pendingUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = pendingUrls.current;
    return () => {
      uploads.current?.abort();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  const mode = run.demo.mode ?? (clips.length ? "single" : undefined);
  const [busy, setBusy] = useState<string | null>(null); // clip id (or "single") being uploaded
  // undefined = nothing chosen yet: the first filmed clip is open, so its preview shows straight away.
  const [openPick, setOpenId] = useState<string | null | undefined>(undefined);
  const openId = openPick === undefined ? (clips.find((c) => clipSrc(c))?.id ?? null) : openPick;
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

  async function takeMany(list: FileList | null, from?: string) {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("video/"));
    if (!files.length) {
      if (list?.length) setError("Please choose video files.");
      return;
    }
    setError(null);
    setBusy(from ?? "single");
    // File-name order (IMG_2 before IMG_10). Each shows at once from the file on this computer, spinning until it lands.
    const sorted = [...files].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
    const items = sorted.map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
    items.forEach((item) => pendingUrls.current.add(item.url));
    setPending((p) => [...p, ...items]);
    const clear = (gone: typeof items) => {
      setPending((p) => p.filter((x) => !gone.includes(x)));
      gone.forEach((x) => { if (pendingUrls.current.delete(x.url)) URL.revokeObjectURL(x.url); });
    };
    let next = 0;
    const control = new AbortController();
    uploads.current = control;
    try {
      // The clip the seller has open stays open while and after new ones land.
      await onFiles(sorted, from, (i) => { clear([items[i]]); next = i + 1; }, control.signal);
    } catch (e) {
      const canceled = control.signal.aborted;
      // An earlier file failed: stop the remaining transfers instead of hiding their tiles while they keep uploading.
      control.abort();
      if (!canceled) setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      clear(items.slice(next));
      if (uploads.current === control) {
        uploads.current = null;
        setBusy(null);
      }
    }
  }

  /** Start over or Cancel: stops every upload at once and takes their tiles away. */
  function stopUploads() {
    uploads.current?.abort();
    uploads.current = null;
    for (const url of pendingUrls.current) URL.revokeObjectURL(url);
    pendingUrls.current.clear();
    setPending([]);
    setBusy(null);
  }

  const fileInput = (id: string, onFile: (f: File) => Promise<void>) => (
    <input type="file" accept="video/*" className="hidden" onChange={(e) => void take(id, e.target.files?.[0], onFile).then(() => (e.target.value = ""))} />
  );

  // Videos dragged in from the computer, anywhere on this step (tiles dragged between each other carry no files).
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const dropZone = {
    onDragOver: (e: React.DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setFileOver(true); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false); },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setFileOver(false);
      if (!busy) void takeMany(e.dataTransfer.files);
    },
  };
  const dropRing = fileOver ? "ring-2 ring-accent ring-offset-4 ring-offset-panel" : "";
  const uploadingTiles = pending.map((p) => (
    <li key={p.url} className="w-[96px]">
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-ink">
        <video src={`${p.url}#t=0.5`} muted playsInline preload="metadata" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
          <Loader2 className="h-5 w-5 animate-spin" />
        </span>
      </div>
      <p className="mt-1.5 truncate text-[12.5px] leading-tight text-muted">{p.name}</p>
    </li>
  ));

  if (!mode) {
    // One box of choices, like step 2: upload, plan it shot by shot, or reuse a demo from My files.
    return (
      <div {...dropZone} className={`rounded-2xl border border-line bg-panel p-4 ${dropRing}`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className={`btn-primary cursor-pointer px-4 py-2.5 text-[14px] ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy === "single" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload your demo
            <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => void takeMany(e.target.files).then(() => (e.target.value = ""))} />
          </label>
          <button type="button" onClick={onClips} disabled={copying} className={`${optionBtn(false)} disabled:opacity-70`}>
            {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListOrdered className="h-4 w-4" />}
            Plan it shot by shot
          </button>
          <button type="button" onClick={onCheckLibrary} className={optionBtn(false)}>
            <FolderOpen className="h-4 w-4" />
            Check library
          </button>
        </div>
        {pending.length > 0 && (
          <>
            <ol className="mt-3 flex flex-wrap gap-3" aria-label="Uploading clips">{uploadingTiles}</ol>
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={stopUploads} className="rounded-lg px-2 py-1.5 text-[13px] font-semibold text-soft hover:text-text">Cancel</button>
            </div>
          </>
        )}
        {error && <p role="alert" className="mt-2.5 text-[13px] font-semibold text-red-600">{error}</p>}
      </div>
    );
  }

  // One row of 9:16 tiles, like a phone editor's clip strip: filmed clips show a frame, shots still to film are
  // dashed with their name. Click a tile to open it below; drop one tile on another to put it in that place.
  // A clip that was Cut stays one tile: its halves sit side by side, each with its own settings (founder 2026-11-03).
  const tiles = clips.reduce<DemoClip[][]>((out, c) => {
    const last = out[out.length - 1];
    if (last && c.group && last[0].group === c.group) last.push(c);
    else out.push([c]);
    return out;
  }, []);
  const selected = clips.find((c) => c.id === openId) ?? null;
  const selSeg = selected ? segs.find((s) => s.id === selected.id) : undefined;
  const members = selected ? clipGroup(clips, selected.id) : [];
  const selIndex = selected ? tiles.findIndex((g) => g.includes(selected)) : -1;
  return (
    <div {...dropZone} className={`space-y-4 rounded-xl ${dropRing}`}>
      <ol className="flex flex-wrap gap-3" aria-label="Demo clips">
        {tiles.map((group, i) => {
          const c = group[0];
          const filmed = Boolean(clipSrc(c));
          const on = group.some((x) => x.id === openId);
          const lens = group.map((x) => segs.find((s) => s.id === x.id)?.len);
          const len = lens.every((x) => x !== undefined) ? lens.reduce((a: number, x) => a + (x ?? 0), 0) : c.target;
          return (
            <li key={c.id} className="w-[96px]">
              <button
                type="button"
                draggable={tiles.length > 1}
                aria-label={`${c.label}${filmed ? "" : ", not filmed yet"}`}
                aria-pressed={on}
                title={tiles.length > 1 ? "Click to open. Drag onto another clip to put it there." : undefined}
                onClick={() => setOpenId(on ? null : c.id)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", c.id);
                  setDragId(c.id);
                }}
                onDragEnd={() => { setDragId(null); setDropAt(null); }}
                onDragOver={(e) => {
                  // The drag data names the dragged clip even before React has stored dragId.
                  if (dragId === c.id || !e.dataTransfer.types.includes("text/plain")) return;
                  e.preventDefault();
                  setDropAt(i);
                }}
                onDragLeave={() => setDropAt((d) => (d === i ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  // Videos dropped on a shot still to film start from that shot; on a filmed clip, the step's drop handles them.
                  if (hasFiles(e)) {
                    setDropAt(null);
                    if (filmed) return;
                    e.stopPropagation();
                    setFileOver(false);
                    if (!busy) void takeMany(e.dataTransfer.files, c.id);
                    return;
                  }
                  const from = e.dataTransfer.getData("text/plain") || dragId;
                  if (from && !group.some((x) => x.id === from) && clips.some((x) => x.id === from)) onSwap(from, c.id);
                  setDragId(null);
                  setDropAt(null);
                }}
                onKeyDown={(e) => {
                  // Arrow keys move the whole tile one place (a cut clip's halves move together).
                  if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); onSwap(c.id, tiles[i - 1][0].id); }
                  if (e.key === "ArrowRight" && i < tiles.length - 1) { e.preventDefault(); onSwap(tiles[i + 1][0].id, c.id); }
                }}
                className={`relative block aspect-[9/16] w-full overflow-hidden rounded-xl transition-[box-shadow,opacity] ${filmed ? "bg-ink" : "border-2 border-dashed border-line-strong bg-panel hover:border-accent"} ${on ? "ring-2 ring-accent ring-offset-2 ring-offset-panel" : ""} ${dropAt === i ? "ring-2 ring-accent" : ""} ${dragId === c.id ? "opacity-40" : ""} ${tiles.length > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                {filmed ? (
                  <MediaVideo src={`${previewOf(clipSrc(c))}#t=0.5`} muted preload="metadata" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-soft">
                    {busy === c.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                  </span>
                )}
                <span className={`absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ${filmed ? "bg-black/60 text-white" : "bg-raised text-muted"}`}>{i + 1}</span>
                {len ? <span className={`absolute bottom-1.5 right-1.5 rounded px-1 text-[11px] font-semibold tabular-nums ${filmed ? "bg-black/60 text-white" : "text-soft"}`}>{filmed ? `${len.toFixed(1)}s` : `~${len}s`}</span> : null}
              </button>
              <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-tight text-muted">{c.label}</p>
            </li>
          );
        })}
        {uploadingTiles}
        <li className="w-[96px]">
          <label className={`flex aspect-[9/16] w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-line text-soft hover:border-accent hover:text-accent ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy === "single" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            <span className="text-[12.5px] font-semibold">Add clip</span>
            <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => void takeMany(e.target.files).then(() => (e.target.value = ""))} />
          </label>
        </li>
      </ol>
      {error && <p role="alert" className="text-[13px] font-semibold text-red-600">{error}</p>}

      {selected && (
        <div className="rounded-2xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="text-[13px] font-bold tabular-nums text-soft">{selIndex + 1}</span>
            <input
              value={selected.label}
              maxLength={60}
              onChange={(e) => members.forEach((m) => onRename(m.id, e.target.value))}
              aria-label={`Clip ${selIndex + 1} name`}
              className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none"
            />
            {clipSrc(selected) ? (
              <label title="Replace video" aria-label="Replace video" className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-accent ${busy ? "pointer-events-none opacity-60" : ""}`}>
                {busy === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
                {fileInput(selected.id, (f) => onUpload(selected.id, f))}
              </label>
            ) : (
              <label className={`btn-primary shrink-0 cursor-pointer px-3.5 py-2 text-[13px] ${busy ? "pointer-events-none opacity-60" : ""}`}>
                {busy === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Upload clip
                <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => void takeMany(e.target.files, selected.id).then(() => (e.target.value = ""))} />
              </label>
            )}
            <button type="button" onClick={() => { onDelete(selected.id); setOpenId(members.find((m) => m.id !== selected.id)?.id ?? null); }} aria-label={members.length > 1 ? `Delete part ${members.indexOf(selected) + 1}` : `Delete clip ${selIndex + 1}`} title={members.length > 1 ? "Delete this part" : "Delete clip"} className="rounded-lg p-2 text-soft hover:bg-red-50 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setOpenId(null)} aria-label="Close" className="rounded-lg p-2 text-soft hover:bg-raised hover:text-text">
              <X className="h-4 w-4" />
            </button>
          </div>
          {members.length > 1 && (
            // The halves of a cut clip, in order and to scale: pick one to edit it on its own.
            <div role="group" aria-label="Parts of this clip" className="flex gap-1 px-3 pt-3">
              {members.map((m, k) => {
                const len = segs.find((s) => s.id === m.id)?.len;
                const here = m.id === selected.id;
                return (
                  <button key={m.id} type="button" aria-pressed={here} onClick={() => setOpenId(m.id)} style={{ flexGrow: len ?? 1, flexBasis: 0 }}
                    className={`h-9 min-w-[48px] rounded-lg text-[12.5px] font-bold tabular-nums ${here ? "bg-accent text-white" : "bg-raised text-muted hover:text-text"}`}>
                    {k + 1}{len ? ` · ${len.toFixed(1)}s` : ""}
                  </button>
                );
              })}
            </div>
          )}
          {clipSrc(selected) && selSeg ? (
            <div className="p-3">{renderEditor(selSeg)}</div>
          ) : selected.camera || selected.steps?.length ? (
            <div className="pt-3"><ShotBrief clip={selected} /></div>
          ) : (
            <p className="px-4 py-3 text-[13.5px] text-muted">{selected.hint}</p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={() => { stopUploads(); onReset(); }} className="rounded-lg px-2 py-1.5 text-[13px] font-semibold text-soft hover:text-text">
          Start over
        </button>
      </div>
    </div>
  );
}

/** Step 3 Advanced settings: brightness, contrast, saturation, warmth and zoom of the hook clip. */
function AdvancedSettings({ value, disabled, onChange, motion, keyOn, onMotion, onKey, playback, defaultOpen = false }: {
  playback?: { clock: PlaybackClock; seg: Seg; change: (a: Partial<Adjust>) => void };
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
          {ADJUST_ROWS.map(r => r.key === "zoom" && playback
            ? <ClockedMotionRow key={r.key} row={r} value={value} playback={playback} />
            : <AdjustmentControl key={r.key} r={r} v={v} motion={motion} keyOn={keyOn} onMotion={onMotion} onChange={onChange} onKey={onKey} />)}
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

function AdjustmentControl({ r, v, motion, keyOn, onMotion, onChange, onKey }: {
  r: AdjustRow; v: ReturnType<typeof fullAdjust>; motion: Motion; keyOn: boolean;
  onMotion: (p: Partial<Motion>) => void; onChange: (a: Partial<Adjust>) => void; onKey: () => void;
}) {
  const hasKeys = v.keys.length > 0;
  const set = (key: AdjustRow["key"], n: number) => {
    const row = ADJUST_ROWS.find((r) => r.key === key);
    if (!row || Number.isNaN(n)) return;
    const snapped = Number((Math.round(Math.max(row.min, Math.min(row.max, n)) / row.step) * row.step).toFixed(2));
    if (key === "zoom") onMotion({ zoom: snapped });
    else onChange({ ...v, [key]: snapped });
  };
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
}

function ClockedMotionRow({ row, value, playback }: {
  row: AdjustRow; value?: Partial<Adjust>;
  playback: { clock: PlaybackClock; seg: Seg; change: (a: Partial<Adjust>) => void };
}) {
  const time = useSyncExternalStore(playback.clock.subscribe, () => value?.keys?.length ? playback.clock.get() : 0, () => 0);
  const fileTime = (t: number) => fileAt(playback.seg, Math.max(0, Math.min(playback.seg.len, t - playback.seg.offset))).file;
  const at = fileTime(time);
  return <AdjustmentControl r={row} v={fullAdjust(value)} motion={motionAt(value, at)} keyOn={keyAt(value, at) >= 0}
    onChange={playback.change}
    onMotion={patch => playback.change(setMotion(value, fileTime(playback.clock.get()), patch))}
    onKey={() => playback.change(toggleKey(value, fileTime(playback.clock.get())))} />;
}

/** One on-screen text: field, emoji, ▾ for font / color / style, and + / delete. */


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
    if (!v || !ps.length || !playing) return;
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
    return () => { cancelAnimationFrame(raf); v.pause(); };
  }, [key, rate, playing]);
  return <MediaVideo ref={ref} src={src} autoPlay={playing} muted={muted} loop playsInline className="absolute inset-0 h-full w-full object-cover" style={style} />;
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

/** A piece of a Cut clip: "Hook 2", or "Clip 1.2" when the name already ends in a number. */
const pieceName = (name: string, i: number) => (/\d$/.test(name) ? `${name}.${i + 1}` : `${name} ${i + 1}`);

/** Player bar under a clip: play/pause, time, ruler, the clip's pieces side by side (Cut splits the piece under
 *  the playhead; the selected piece has trim handles and can be deleted), text bars, keyframes, Undo. */
function ClipControls({ label, src, speed = 1, playing, onPlay, t, len, pieces, selected, onSelect, draft, onTrim, onTrimEnd, onDelete, onSeek, onCut, canCut, texts, onTiming, keys, onKeyMove, canUndo, onUndo }: {
  label: string;
  playing: boolean;
  onPlay: () => void;
  t: number;
  len: number;
  /** The clip's file (frame strips on the pieces, like the full editor) and its speed. */
  src?: string;
  speed?: number;
  /** The clip's pieces, on-screen: where each starts and how long it plays (and, for the frames, which part of the file). */
  pieces: { id: string; at: number; len: number; start?: number; end?: number }[];
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
  // The bar's width in pixels: how many frames fit on each piece.
  const [areaW, setAreaW] = useState(0);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAreaW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
          {/* Always there, like the full editor's: greyed out until there is something to undo. */}
          <button type="button" disabled={!canUndo} onClick={onUndo} title="Undo" aria-label="Undo" className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-text disabled:text-soft disabled:opacity-50 disabled:hover:bg-transparent">
            <Undo2 className="h-4 w-4" />
          </button>
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
        <div className="relative h-12 cursor-pointer overflow-hidden rounded-md bg-[repeating-linear-gradient(135deg,var(--raised),var(--raised)_4px,var(--line)_4px,var(--line)_6px)]" onPointerDown={(e) => track(e, onSeek)}>
          {/* the pieces, side by side (one until the clip is Cut) */}
          {pieces.map((p, i) => {
            // While trimming, the piece keeps its start and the pieces after it slide along (no gap).
            const cutBy = draft ? pieces[draft.i].len - (draft.b - draft.a) : 0;
            const [pa, pb] = draft?.i === i ? [p.at, p.at + draft.b - draft.a] : draft && i > draft.i ? [p.at - cutBy, p.at + p.len - cutBy] : [p.at, p.at + p.len];
            const on = pieces.length > 1 && p.id === selected;
            const dim = Boolean(selected) && pieces.length > 1 && !on;
            // Frames across the piece (one every 28px) from the part of the file it plays, rounded to 0.5s so they are reused.
            const FRAME = 28;
            const pps = areaW / len;
            const count = src && pps > 0 && p.start !== undefined && p.end !== undefined ? Math.min(60, Math.max(1, Math.ceil((p.len * pps) / FRAME))) : 0;
            const times = Array.from({ length: count }, (_, k) => Math.round(Math.min((p.end ?? 0) - 0.05, (p.start ?? 0) + ((k * FRAME + FRAME / 2) / pps) * speed) * 2) / 2);
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
                className={`absolute inset-y-0 flex items-center overflow-hidden px-4 text-[10.5px] font-bold text-white outline-none ${dim && !count ? "bg-[#a39eb5]" : "bg-[#221d33]"} ${i > 0 ? "border-l-2 border-panel" : ""} ${on ? "ring-2 ring-inset ring-accent" : ""}`}
                style={{ left: pct(pa), width: `calc(${pct(pb)} - ${pct(pa)})` }}
              >
                {src && count > 0 && <Filmstrip src={src} times={times} frame={FRAME} />}
                {/* Not selected while another piece is: lighter. */}
                {dim && count > 0 && <span aria-hidden className="pointer-events-none absolute inset-0 bg-white/55" />}
                <span className={`relative truncate ${count > 0 ? "rounded bg-black/60 px-1.5 py-0.5" : ""}`}>{pieces.length > 1 ? pieceName(label, i) : label}</span>
                {on && <span aria-hidden className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-accent" />}
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

/** About how long one hook takes (outfit, swapped first frame, then Kling Motion Control), for the progress cover. */

const GEN_STAGES = ["Reading the hook", "Matching {who}", "Animating the moves", "Finishing up"];

/** While a hook generates: the character with a scan line, the current stage, a timer and an easing progress bar. */
export function GenerateProgress({ photo, who, startedAt, estimate }: { photo: string | null; who: string; startedAt: number; estimate: number }) {
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



/** 12 swatches + a custom picker. `done` is false while dragging the custom picker (keep the menu open). */






/** Small dropdown: a button and a panel under it; closes on outside click or Escape. */




/** Font dropdown with search; each name is shown in its own font (preview glyphs only, loaded on open). */


/** One step of the composer. The header always toggles it; closed steps show a one-line summary. */

const SongBrowser = dynamic(() => import("@/components/song-browser").then(m=>m.SongBrowser));

const TextRow = dynamic(() => import("@/components/text-controls").then(m=>m.TextRow));
