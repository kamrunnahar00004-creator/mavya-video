"use client";
import { MediaVideo } from "@/components/media-video";
import { previewOf } from "@/lib/media-preview";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Adjust, contrastId, contrastTable, exposureId, exposureTable, fullAdjust, speedOf, videoStyle, warmthId, warmthMatrix } from "@/lib/adjust";
import { type Seg, fileAt, pieceSpans, segAt, showsAt, timeline, videoLength } from "@/lib/edit";
import { pieceEnd, soundPieces } from "@/lib/sound";
import { Pause, Play } from "lucide-react";
import { AVATAR_TONES, round1 } from "@/lib/client";
import { fontCss, loadFonts } from "@/lib/studio-data";
import { textLook } from "@/lib/text-styles";
import type { Reference, Run, TextLayer } from "@/lib/types";
import { AvatarPlaceholder } from "@/components/frames";

/**
 * The finished video on a phone, to watch: hook, then the demo clips, with texts and sound, on one clock.
 * Watch only (every edit happens in its step); play / pause and a progress bar you can scrub.
 */
export function RunPreview({ run, source, texts, hookCover }: { run: Run; source: Reference | null; texts: TextLayer[]; /** Shown over the hook part while it is generated. */ hookCover?: React.ReactNode }) {
  const hook = run.hook;
  const segs = useMemo(() => timeline(run, source), [run, source]);
  const total = videoLength(segs);
  const pieces = useMemo(() => soundPieces(run, total), [run, total]);

  const [t, setT] = useState(0);
  // Starts paused: the preview plays only when the seller presses play.
  const [playing, setPlaying] = useState(false);
  usePlaybackClaims("phone", setPlaying);

  // One clock for the whole preview. Plays once: at the end it goes back to 0 and stays paused.
  // While a video plays, the clock follows that video's own time, so the picture never has to jump to catch up: if
  // the video waits a moment (loading, a join), the clock waits with it. Gaps without a video run on the wall clock.
  const tNow = useRef(t);
  useEffect(() => { tNow.current = t; }, [t]);
  const masterRef: Master = useRef(null);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    let held = 0;
    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      let next = tNow.current + dt;
      const m = masterRef.current;
      if (m && m.v.readyState >= 2) {
        const vt = m.time(m.v.currentTime);
        // Follow the video when it is near the clock; a video stuck for over a second is left behind.
        if (vt <= tNow.current && held < 1) { held += dt; next = tNow.current; }
        else if (vt < tNow.current + 0.5) { held = 0; next = vt; }
      }
      if (next >= total) {
        tNow.current = 0;
        setT(0);
        setPlaying(false);
        return;
      }
      tNow.current = next;
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const time = Math.min(t, total - 0.001);
  const hit = segAt(segs, time);
  const seg = hit ?? segs[segs.length - 1];
  const { file: at, i: piece } = fileAt(seg, time - seg.offset);
  const bar = useRef<HTMLDivElement>(null);

  function scrub(e: React.PointerEvent) {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect) return;
    const to = (x: number) => Math.max(0, Math.min(total - 0.01, ((x - rect.left) / rect.width) * total));
    setPlaying(false);
    setT(to(e.clientX));
    const move = (ev: PointerEvent) => setT(to(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    // The phone is sized to fit the screen's height, so the play bar never falls below the fold.
    <div className="flex w-full flex-col items-center gap-4" style={{ maxWidth: "min(258px, calc((100dvh - 230px) * 9 / 19.5 + 13px))" }}>
      {/* Generic current phone: brushed metal frame with a lit edge, very thin bezel, floating island, Action /
          volume / power / camera buttons. No brand. */}
      <div className="relative w-full rounded-[48px] bg-[linear-gradient(150deg,#eceef1_0%,#a7aab1_22%,#d6d8dc_48%,#8d9098_76%,#c9cbd0_100%)] p-[2.5px] shadow-[0_34px_70px_-26px_rgba(15,23,42,0.6),0_2px_6px_rgba(15,23,42,0.18)]">
        <span aria-hidden className="pointer-events-none absolute inset-[1px] rounded-[47px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.55),inset_0_-1px_2px_rgba(0,0,0,0.25)]" />
        <span aria-hidden className="absolute -left-[2.5px] top-[17%] h-[4.5%] w-[2.5px] rounded-l-sm bg-[linear-gradient(90deg,#7f828a,#b9bbc1)]" />
        <span aria-hidden className="absolute -left-[2.5px] top-[25%] h-[8%] w-[2.5px] rounded-l-sm bg-[linear-gradient(90deg,#7f828a,#b9bbc1)]" />
        <span aria-hidden className="absolute -left-[2.5px] top-[35%] h-[8%] w-[2.5px] rounded-l-sm bg-[linear-gradient(90deg,#7f828a,#b9bbc1)]" />
        <span aria-hidden className="absolute -right-[2.5px] top-[27%] h-[12%] w-[2.5px] rounded-r-sm bg-[linear-gradient(270deg,#7f828a,#b9bbc1)]" />
        <span aria-hidden className="absolute -right-[2px] top-[56%] h-[7%] w-[2px] rounded-r-sm bg-[linear-gradient(270deg,#5d6068,#9a9da4)]" />
        <div className="rounded-[45.5px] bg-black p-[4px]">
          <div
            role="button"
            tabIndex={0}
            aria-label={playing ? "Pause" : "Play"}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              if (!playing) claimPlayback("phone");
              setPlaying((p) => !p);
            }}
            onClick={() => {
              if (!playing) claimPlayback("phone");
              setPlaying((p) => !p);
            }}
            className="relative aspect-[9/19.5] w-full cursor-pointer overflow-hidden rounded-[41.5px] bg-black [container-type:size]"
          >
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-[5.8%] items-center justify-between pl-[11%] pr-[8.5%] text-[11.5px] font-semibold tracking-[-0.01em] text-white">
              <span>9:41</span>
              <span className="flex items-center gap-[4px]">
                <svg viewBox="0 0 18 12" className="h-[8.5px] w-auto fill-white"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
                <svg viewBox="0 0 16 12" className="h-[8.5px] w-auto fill-white"><path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.7 10.7 0 0 0 8 .4C5.2.4 2.5 1.5.5 3.4l1.2 1.3A9 9 0 0 1 8 2.2Zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.2-1.3A7.2 7.2 0 0 0 8 4c-1.8 0-3.5.7-4.9 1.9l1.2 1.3c1-.9 2.3-1.4 3.7-1.4Zm0 3.5c-.5 0-1 .2-1.3.5L8 11.2l1.3-1.4c-.3-.3-.8-.5-1.3-.5Z" /></svg>
                <svg viewBox="0 0 27 12" className="h-[9.5px] w-auto"><rect x="0.5" y="0.5" width="23" height="11" rx="3.4" fill="none" stroke="white" strokeOpacity="0.45" /><rect x="2" y="2" width="17" height="8" rx="2" fill="white" /><path d="M25 4.2v3.6c.7-.3 1.2-1 1.2-1.8s-.5-1.5-1.2-1.8Z" fill="white" fillOpacity="0.5" /></svg>
              </span>
            </div>
            {/* Floating island with its front camera. */}
            <span aria-hidden className="pointer-events-none absolute left-1/2 top-[1.55%] z-30 flex h-[3.7%] w-[31%] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-[5%]">
              <span className="h-[38%] w-auto aspect-square rounded-full bg-[radial-gradient(circle_at_35%_35%,#3b4b6b,#0b0f18_70%)]" />
            </span>
            {/* Home indicator and a faint glass sheen. */}
            <span aria-hidden className="pointer-events-none absolute bottom-[0.9%] left-1/2 z-30 h-[4px] w-[35%] -translate-x-1/2 rounded-full bg-white/85" />
            <span aria-hidden className="pointer-events-none absolute inset-0 z-30 rounded-[41.5px] bg-[linear-gradient(118deg,rgba(255,255,255,0.09)_0%,rgba(255,255,255,0)_32%)]" />
            {/* The video is 9:16 like the export and the clip editors, so its texts wrap and sit the same in all of them.
                The taller phone screen shows it full width, like TikTok does on a tall phone. */}
            <div className="absolute inset-x-0 top-1/2 aspect-[9/16] w-full -translate-y-1/2 overflow-hidden [container-type:size]">
            {!hit ? null : seg.src ? (
              <>
                <WarmthFilter adjust={seg.editable ? seg.adjust : null} />
                <SegmentVideos segs={segs} seg={seg} at={at} piece={piece} playing={playing} masterRef={masterRef} />
                {seg.id === "hook" && hook.face && hook.face.kind !== "described" && !hook.clip && !hook.generated && (
                  <span className="pointer-events-none absolute left-2 top-8 flex items-center gap-1.5 rounded-lg bg-black/55 px-2 py-1 text-[10.5px] font-bold text-white">
                    <span className="relative h-4 w-4 overflow-hidden rounded-full">
                      {hook.face.kind === "ai" ? (
                        <AvatarPlaceholder tones={AVATAR_TONES[hook.face.index]} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={hook.face.kind === "character" ? `/characters/thumbs/${hook.face.id}.jpg` : `/api/media/${hook.face.mediaId}`} alt="" className="h-full w-full object-cover" />
                      )}
                    </span>
                    Face swap preview
                  </span>
                )}
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-[#14121f] text-[12px] font-semibold text-white/40">{seg.id === "hook" ? "Your hook" : "Your demo"}</div>
            )}
            {seg.id === "hook" && hookCover}
            {texts.filter((x) => x.text.trim() && showsAt(x, time)).map((x) => <TextOverlay key={x.id} x={x} />)}
            </div>
            {!playing && (
              <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white">
                  <Play className="ml-1 h-6 w-6" fill="currentColor" />
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      {pieces.map((p, i, all) => (
        <SyncedAudio key={p.id} src={p.src} at={soundAt({ ...p, end: pieceEnd(all, i, total) }, time)} playing={playing} volume={p.volume / 100} />
      ))}

      {/* Play bar: one control, the time, and the video's parts as a scrubbable bar. */}
      <div className="flex w-full items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (!playing) claimPlayback("phone");
            setPlaying((p) => !p);
          }}
          className="btn-primary h-8 w-8 shrink-0 rounded-full p-0"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />}
        </button>
        <div ref={bar} role="slider" tabIndex={0} aria-label="Preview time" aria-valuemin={0} aria-valuemax={total} aria-valuenow={time} onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation(); setPlaying(false);
          setT(e.key === "Home" ? 0 : e.key === "End" ? total - 0.01 : Math.max(0, Math.min(total - 0.01, time + (e.key === "ArrowRight" ? 0.1 : -0.1))));
        }} onPointerDown={scrub} className="relative h-6 min-w-0 flex-1 cursor-pointer touch-none focus-visible:outline-2 focus-visible:outline-accent">
          <div className="absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2 gap-[2px] overflow-hidden rounded-full">
            {segs.map((x) => (
              <span key={x.id} className="absolute h-full bg-line" style={{ left: `${(x.offset / total) * 100}%`, width: `${(x.len / total) * 100}%` }} />
            ))}
          </div>
          <div className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${(time / total) * 100}%` }} />
          <span className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow" style={{ left: `${(time / total) * 100}%` }} />
        </div>
        <span className="shrink-0 text-[12.5px] tabular-nums text-muted">
          {fmtClock(time)} / {fmtClock(total)}
        </span>
      </div>
    </div>
  );
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ---------------- Media + text rendering ---------------- */

/** A video that follows the preview clock: plays with it, seeks when scrubbed. */
/** Hidden SVG holding the Exposure, Contrast and Temp filters that videoStyle() points to. */
export function WarmthFilter({ adjust }: { adjust?: Partial<Adjust> | null }) {
  const w = adjust?.warmth ?? 0;
  const c = adjust?.contrast ?? 0;
  const e = adjust?.brightness ?? 0;
  if (!w && !c && !e) return null;
  const table = c ? contrastTable(c) : "";
  const lift = e ? exposureTable(e) : "";
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      {e ? (
        <filter id={exposureId(e)} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={lift} />
            <feFuncG type="table" tableValues={lift} />
            <feFuncB type="table" tableValues={lift} />
          </feComponentTransfer>
        </filter>
      ) : null}
      {w ? (
        <filter id={warmthId(w)} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={warmthMatrix(w)} />
        </filter>
      ) : null}
      {c ? (
        <filter id={contrastId(c)} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={table} />
            <feFuncG type="table" tableValues={table} />
            <feFuncB type="table" tableValues={table} />
          </feComponentTransfer>
        </filter>
      ) : null}
    </svg>
  );
}

/** How long before its turn the next piece starts rolling (hidden, nearly still), so it plays the moment it shows. */
const PREROLL = 0.35;

/**
 * The piece playing now and, invisible, the piece after it (the next piece of a Cut clip, or the next clip's first
 * piece), each its own player in one keyed list: when the clock reaches the next piece, that same element (already
 * loaded and already rolling) becomes the visible one. No seek, no start-up pause, no blank frame between clips
 * (founder 2026-10-30 and 2026-11-03: joins like CapCut, 100% smooth).
 */
export function SegmentVideos({ segs, seg, at, piece, playing, masterRef }: { segs: Seg[]; seg: Seg; at: number; piece: number; playing: boolean; /** Set: the clock follows the playing video. */ masterRef?: Master }) {
  const rateOf = (s: Seg) => (s.editable ? speedOf(s.adjust) : 1);
  const nextSeg = segs.slice(segs.indexOf(seg) + 1).find((s) => s.src);
  const next = piece + 1 < seg.parts.length ? { s: seg, i: piece + 1 } : nextSeg ? { s: nextSeg, i: 0 } : null;
  // On-screen time left in the piece playing now (a gap before the next clip counts too).
  const gap = next && next.s !== seg ? next.s.offset - (seg.offset + seg.len) : 0;
  const left = (seg.parts[piece].end - at) / rateOf(seg) + gap;
  // Two players take turns in fixed places: the one playing is never moved in the page when the next takes over
  // (moving a playing video makes the browser rebuild its picture, a visible freeze).
  const g = segs.slice(0, segs.indexOf(seg)).reduce((n, s) => n + s.parts.length, 0) + piece;
  const list = [{ s: seg, i: piece, now: true, slot: g % 2 }, ...(next ? [{ ...next, now: false, slot: (g + 1) % 2 }] : [])]
    .filter((x) => x.s.src)
    .sort((a, b) => a.slot - b.slot);
  const p = seg.parts[piece];
  const span = pieceSpans(seg)[piece];
  // The playing video's own time on the timeline: the preview's clock follows it (see RunPreview).
  // At the piece's last frame it is a hair past the end, so the next piece always takes over (no rounding stall).
  const time = (ct: number) => seg.offset + span.at + (Math.max(p.start, Math.min(p.end, ct)) - p.start) / rateOf(seg) + (ct >= p.end - 0.001 ? 0.0001 : 0);
  return (
    <>
      {list.map(({ s, i, now }) => {
        const sAt = now ? at : s.parts[i].start;
        const look = s.editable ? videoStyle(s.adjust, sAt) : undefined;
        return (
          <SyncedVideo
            key={`${s.id}|${s.src}|${i}`}
            src={s.id === "hook" ? s.src! : previewOf(s.src!)}
            at={sAt}
            piece={i}
            playing={now && playing}
            preroll={!now && playing && left <= PREROLL}
            masterRef={now ? masterRef : undefined}
            masterTime={now ? time : undefined}
            rate={rateOf(s)}
            volume={now && s.editable ? fullAdjust(s.adjust).volume / 100 : 0}
            style={now ? look : { ...look, opacity: 0 }}
          />
        );
      })}
    </>
  );
}

/** The video the preview's clock follows, and how its time maps onto the timeline. */
export type Master = React.RefObject<{ v: HTMLVideoElement; time: (ct: number) => number } | null>;

/** The slowest rate browsers play at: a pre-rolling video moves about 0.02s before its turn. */
const CREEP = 0.0625;

export function SyncedVideo({ src, at, piece = 0, playing, preroll = false, masterRef, masterTime, style, rate = 1, volume = 0 }: { src: string; at: number; /** Which piece of a Cut clip plays; a new piece always jumps to its frame. */ piece?: number; playing: boolean; /** Hidden and about to play: already running, almost still, so it starts with no delay. */ preroll?: boolean; /** This is the video the clock follows. */ masterRef?: Master; masterTime?: (ct: number) => number; style?: React.CSSProperties; rate?: number; volume?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!masterRef || !masterTime || !v) return;
    masterRef.current = { v, time: masterTime };
    return () => { if (masterRef.current?.v === v) masterRef.current = null; };
  });
  // Browsers only allow sound after the page was clicked once; until then the video plays silently (it would not play at all otherwise).
  const unlocked = useSoundUnlocked();
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, volume));
    v.muted = volume <= 0 || !unlocked;
  }, [volume, unlocked]);
  const prerollRef = useRef(preroll);
  useEffect(() => {
    prerollRef.current = preroll;
  }, [preroll]);
  useEffect(() => {
    if (ref.current && !prerollRef.current) ref.current.playbackRate = rate;
  }, [rate]);
  const atRef = useRef(at);
  useEffect(() => {
    atRef.current = at;
  }, [at]);
  useEffect(() => {
    const v = ref.current;
    if (!v || playing) return;
    if (preroll) {
      // Start the decoder now, barely moving, from this piece's first frame.
      v.currentTime = atRef.current;
      v.playbackRate = CREEP;
      void v.play().catch(() => undefined);
    } else if (!v.paused) {
      // Paused before its turn came: back to its first frame, normal speed.
      v.pause();
      v.playbackRate = rate;
      v.currentTime = atRef.current;
    }
  }, [preroll, playing, rate]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) {
      v.playbackRate = rate;
      if (Math.abs(v.currentTime - atRef.current) > 0.3) v.currentTime = atRef.current;
      if (v.paused) void v.play().catch(() => undefined);
    } else if (!prerollRef.current) v.pause();
  }, [playing, rate]);
  useEffect(() => {
    const v = ref.current;
    if (!v || v.readyState < 1) return;
    // Paused: follow the scrubber. Playing: only correct real drift (e.g. after a loop); a video the clock follows
    // never drifts, so it is never made to jump.
    if (playing ? !masterRef && Math.abs(v.currentTime - at) > 0.5 : Math.abs(v.currentTime - at) > 0.04) v.currentTime = at;
  }, [at, playing, masterRef]);
  useEffect(() => {
    const v = ref.current;
    if (v && v.readyState >= 1) v.currentTime = atRef.current;
  }, [piece]);
  return (
    <MediaVideo
      ref={ref}
      src={src}
      muted
      playsInline
      preload="auto"
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = atRef.current;
        e.currentTarget.playbackRate = prerollRef.current && !playing ? CREEP : rate;
        if (playing || prerollRef.current) void e.currentTarget.play().catch(() => undefined);
      }}
      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      style={style}
    />
  );
}

/**
 * Where the sound is at video time t, or null while it is silent.
 * The sound plays from video time `at` to `end` (its bar on the timeline), starting at `start` inside the sound.
 * A sound shorter than that loops back to its start point (a 30s song clip under a longer video).
 */
export function soundAt(s: { start: number; length?: number; at?: number; end?: number }, t: number): number | null {
  const from = s.at ?? 0;
  if (t < from - 0.001 || (s.end !== undefined && t >= s.end)) return null;
  const pos = s.start + (t - from);
  const len = s.length ?? 0;
  if (!len || pos < len - 0.05) return pos;
  const span = Math.max(0.5, len - s.start);
  return s.start + ((pos - s.start) % span);
}

/** The run's sound, on a player clock: plays with it, follows scrubbing, loops, and is silent outside its bar (at = null). */
export function SyncedAudio({ src, at, playing, volume }: { src: string; at: number | null; playing: boolean; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  const atRef = useRef(at);
  const live = playing && at !== null;
  useEffect(() => {
    atRef.current = at;
  }, [at]);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    if (live) {
      if (atRef.current !== null && Math.abs(a.currentTime - atRef.current) > 0.3) a.currentTime = atRef.current;
      void a.play().catch(() => undefined);
    } else a.pause();
  }, [live]);
  useEffect(() => {
    const a = ref.current;
    if (!a || a.readyState < 1 || at === null) return;
    if (playing ? Math.abs(a.currentTime - at) > 0.35 : Math.abs(a.currentTime - at) > 0.05) a.currentTime = at;
  }, [at, playing]);
  // Browsers block sound until the page is clicked once: start it on the first click or key press anywhere.
  useEffect(() => {
    const kick = () => {
      const a = ref.current;
      if (a && live && a.paused) void a.play().catch(() => undefined);
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
  }, [live]);
  return <audio ref={ref} src={src} preload="auto" className="hidden" onLoadedMetadata={(e) => (e.currentTarget.currentTime = atRef.current ?? 0)} />;
}

/** True once the page has been clicked or typed in (browsers block sound before that). */
let soundOk = false;
export function useSoundUnlocked() {
  const [ok, setOk] = useState(soundOk);
  useEffect(() => {
    if (ok) return;
    const on = () => {
      soundOk = true;
      setOk(true);
    };
    window.addEventListener("pointerdown", on, { once: true });
    window.addEventListener("keydown", on, { once: true });
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, [ok]);
  return ok;
}

/** Only one player with sound plays at a time: starting one pauses the others. */
const PLAY_EVENT = "mavya:play";
export function claimPlayback(who: string) {
  window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: who }));
}
export function usePlaybackClaims(who: string, setPlaying: (v: boolean) => void) {
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail !== who && setPlaying(false);
    const hide = () => { if (document.hidden) setPlaying(false); };
    window.addEventListener(PLAY_EVENT, on);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener(PLAY_EVENT, on); document.removeEventListener("visibilitychange", hide); };
  }, [who, setPlaying]);
}

/** Text size as shown to people: a whole number, so two texts can be matched exactly. */
export const sizeLabel = (size: number) => Math.round(size * 10);

/** Text layer positioned like on the phone. With `onMove`: drag to move, corner handle to resize. The parent needs `[container-type:size]` (text sizes are in cqh). */
export const TextOverlay = memo(function TextOverlay({ x, onMove: onMoveProp, onPatch }: { x: TextLayer; onMove?: (p: { x?: number; y?: number; size?: number }) => void; onPatch?: (id: string, p: { x?: number; y?: number; size?: number }) => void }) {
  const onMove = onMoveProp ?? (onPatch ? (p: { x?: number; y?: number; size?: number }) => onPatch(x.id, p) : undefined);
  // While resizing: the size, shown next to the cursor.
  const [badge, setBadge] = useState<{ left: number; top: number; size: number } | null>(null);
  function drag(e: React.PointerEvent<HTMLElement>, mode: "move" | "resize") {
    if (!onMove) return;
    e.preventDefault();
    e.stopPropagation();
    const holder = mode === "move" ? e.currentTarget : e.currentTarget.parentElement;
    const rect = holder?.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const clamp = (v: number) => round1(Math.max(5, Math.min(95, v)));
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - sx) / rect.width) * 100;
      const dy = ((ev.clientY - sy) / rect.height) * 100;
      if (mode === "move") onMove({ x: clamp(x.x + dx), y: clamp(x.y + dy) });
      else {
        const size = round1(Math.max(2, Math.min(12, x.size + (dy + dx * (rect.width / rect.height)) / 4)));
        onMove({ size });
        setBadge({ left: ev.clientX, top: ev.clientY, size });
      }
    };
    if (mode === "resize") setBadge({ left: e.clientX, top: e.clientY, size: x.size });
    const up = () => {
      setBadge(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return (
    <div
      onPointerDown={(e) => drag(e, "move")}
      onClick={(e) => onMove && e.stopPropagation()}
      className={`group/text absolute ${onMove ? "cursor-move touch-none select-none hover:outline-dashed hover:outline-[1.5px] hover:outline-offset-4 hover:outline-white/80" : "pointer-events-none"}`}
      style={{ left: `${x.x}%`, top: `${x.y}%`, transform: "translate(-50%, -50%)", width: "88%" }}
    >
      <TextRender x={x} editing={false} onDone={() => undefined} />
      {onMove && (
        <span
          aria-label="Resize text"
          onPointerDown={(e) => drag(e, "resize")}
          className="absolute -bottom-3 -right-3 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-accent bg-white opacity-0 shadow group-hover/text:opacity-100"
        />
      )}
      {badge &&
        createPortal(
          <span role="status" className="pointer-events-none fixed z-[100] rounded-md bg-ink px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums text-white shadow" style={{ left: badge.left + 14, top: badge.top + 14 }}>
            Size {sizeLabel(badge.size)}
          </span>,
          document.body
        )}
    </div>
  );
});

function TextRender({ x, editing, onDone }: { x: TextLayer; editing: boolean; onDone: (t: string) => void }) {
  useEffect(() => loadFonts([x.font]), [x.font]);
  const base: React.CSSProperties = { fontFamily: fontCss(x.font), fontSize: `${x.size}cqh`, fontWeight: 800, lineHeight: 1.12, textAlign: "center", whiteSpace: "pre-wrap", overflowWrap: "break-word", display: "block", outline: "none" };
  const look = textLook(x.style, x.color, x.second);
  const editable = {
    contentEditable: editing,
    suppressContentEditableWarning: true,
    ref: (el: HTMLSpanElement | null) => {
      if (el && editing && document.activeElement !== el) el.focus();
    },
    onBlur: (e: React.FocusEvent<HTMLSpanElement>) => onDone(e.currentTarget.innerText),
    onKeyDown: (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
  };
  if (look.box) {
    return (
      <span style={{ ...base, lineHeight: 1.45 }}>
        <span {...editable} style={{ ...look.text, ...look.box, outline: look.box.outline ?? "none" }}>
          {x.text}
        </span>
      </span>
    );
  }
  return (
    <span {...editable} style={{ ...base, ...look.text }}>
      {x.text}
    </span>
  );
}
