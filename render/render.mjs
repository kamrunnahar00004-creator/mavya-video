// Builds the finished video with ffmpeg from a job spec (see server.mjs and src/app/api/runs/[id]/export/route.ts).
// The look matches the editor preview: each clip covers a 9:16 frame, then flip, zoom / position (with keyframes),
// brightness, warmth, contrast and saturation, then speed. Texts arrive as transparent PNGs drawn by the browser with
// the same CSS as the preview (cropped to the text, with its position), so every text style and font matches.
//
// The server has 512 MB, so the work is split: every clip piece (and every black gap) is rendered on its own to an
// intermediate file of identical format, then one final pass joins them (concat demuxer), lays the texts on top and
// mixes the sound. Memory stays the same however many cuts a video has.

/**
 * @typedef {{ brightness?: number, contrast?: number, saturation?: number, warmth?: number, zoom?: number, panX?: number, panY?: number, flip?: boolean, keys?: { t: number, zoom: number, panX: number, panY: number }[] }} Look
 * @typedef {{ url: string, gap: number, speed: number, volume: number, look: Look | null, pieces: { start: number, end: number }[] }} SpecSegment
 * @typedef {{ url: string, at: number, dur: number, start: number, volume: number }} SpecSound
 * @typedef {{ url: string, start: number, end: number, x: number, y: number }} SpecOverlay
 * @typedef {{ width: number, height: number, fps: number, total: number, segments: SpecSegment[], sounds: SpecSound[], overlays: SpecOverlay[] }} Spec
 * @typedef {{ file: string, hasAudio: boolean, duration: number | null }} Probe
 */

const r = (n) => Math.round(n * 1000) / 1000;
const AF = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
const BASE = ["-nostdin", "-y", "-v", "error", "-filter_complex_threads", "1", "-filter_threads", "1"];
/** Intermediate pieces: fast, near-lossless, all identical so the concat demuxer can join them. */
const PIECE_OUT = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", "-threads", "1", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-f", "matroska"];

/** Smooth (ease in-out) value of keyframe field `k` at file time it + p0, as an ffmpeg expression. */
function curve(keys, k, p0) {
  const F = `(it+${r(p0)})`;
  let e = `${keys[keys.length - 1][k]}`;
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i];
    const b = keys[i + 1];
    const P = `((${F}-${r(a.t)})/${r(Math.max(0.001, b.t - a.t))})`;
    e = `if(lt(${F},${r(b.t)}),${a[k]}+(${b[k] - a[k]})*${P}*${P}*(3-2*${P}),${e})`;
  }
  return `if(lt(${F},${r(keys[0].t)}),${keys[0][k]},${e})`;
}

/** Filters for one clip's look, on a W x H frame (file time of the piece's first frame = p0). */
function look(a, p0, W, H, fps) {
  const v = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, zoom: 0, panX: 0, panY: 0, flip: false, keys: [], ...(a ?? {}) };
  const out = [];
  if (v.flip) out.push("hflip");
  const keys = [...(v.keys ?? [])].sort((x, y) => x.t - y.t);
  if (keys.length) {
    // zoompan: d=1 keeps one output frame per input frame; x / y are the window's top left in the input.
    const z = `(1+(${curve(keys, "zoom", p0)})/100)`;
    out.push(`zoompan=z='${z}':x='(iw-iw/zoom)/2*(1-(${curve(keys, "panX", p0)})/100)':y='(ih-ih/zoom)/2*(1-(${curve(keys, "panY", p0)})/100)':d=1:s=${W}x${H}:fps=${fps}`);
  } else if (v.zoom) {
    const s = 1 + v.zoom / 100;
    const sw = 2 * Math.round((W * s) / 2);
    const sh = 2 * Math.round((H * s) / 2);
    out.push(`scale=${sw}:${sh}`, `crop=${W}:${H}:${Math.round(((sw - W) / 2) * (1 - v.panX / 100))}:${Math.round(((sh - H) / 2) * (1 - v.panY / 100))}`);
  }
  // Same numbers as the preview's CSS (src/lib/adjust.ts videoStyle / ffmpegAdjust).
  const b = 1 + v.brightness / 100;
  const k = (v.warmth / 50) * 0.12;
  if (v.brightness || v.warmth) out.push(`colorchannelmixer=rr=${r(b * (1 + k))}:gg=${r(b * (1 + k * 0.25))}:bb=${r(b * (1 - k))}`);
  if (v.contrast || v.saturation) out.push(`eq=contrast=${r(1 + v.contrast / 100)}:saturation=${r(1 + v.saturation / 50)}`);
  return out;
}

/** The pieces to render, in order: black gaps and clip pieces, each with its on-screen length. */
export function plan(spec) {
  const steps = [];
  spec.segments.forEach((seg, si) => {
    if (seg.gap > 0.01) steps.push({ kind: "gap", len: r(seg.gap) });
    seg.pieces.forEach((p) => steps.push({ kind: "piece", si, start: p.start, end: p.end, len: r(Math.max(0.05, p.end - p.start) / seg.speed) }));
  });
  return steps;
}

/** One step of the plan to an intermediate file. */
export function stepArgs(spec, step, src, out) {
  const { width: W, height: H, fps } = spec;
  if (step.kind === "gap") {
    return [...BASE, "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${fps}:d=${step.len}`, "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`, "-t", String(step.len), "-vf", "format=yuv420p,setsar=1", ...PIECE_OUT, out];
  }
  const seg = spec.segments[step.si];
  const len = step.len;
  const v = [
    `trim=start=${r(step.start)}:end=${r(step.end)}`,
    "setpts=PTS-STARTPTS",
    `scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
    "setsar=1",
    // One frame rate before the look: zoompan makes one frame per input frame at `fps`.
    `fps=${fps}`,
    ...look(seg.look, step.start, W, H, fps),
    ...(seg.speed !== 1 ? [`setpts=PTS/${seg.speed}`] : []),
    `fps=${fps}`,
    "format=yuv420p",
    // Exactly the planned length (texts are timed to it), even if the file ends early.
    `tpad=stop_mode=clone:stop_duration=${len}`,
    `trim=duration=${len}`,
    "setpts=PTS-STARTPTS",
  ];
  const a = src.hasAudio && seg.volume > 0
    ? `[0:a]${[`atrim=start=${r(step.start)}:end=${r(step.end)}`, "asetpts=PTS-STARTPTS", ...(seg.speed !== 1 ? [`atempo=${seg.speed}`] : []), `volume=${r(seg.volume)}`, AF, "apad", `atrim=duration=${len}`, "asetpts=PTS-STARTPTS"].join(",")}[a]`
    : `anullsrc=r=48000:cl=stereo,atrim=duration=${len},${AF}[a]`;
  return [...BASE, "-threads", "1", "-i", src.file, "-filter_complex", `[0:v]${v.join(",")}[v];${a}`, "-map", "[v]", "-map", "[a]", "-t", String(len), ...PIECE_OUT, out];
}

/**
 * The final pass: the joined pieces (a concat list), the texts on top, the sound mixed in.
 * @param {Spec} spec
 * @param {string} list  concat demuxer list of the step files
 * @param {{ sounds: Probe[], overlays: string[] }} local
 */
export function finalArgs(spec, list, local, out) {
  const { fps, total } = spec;
  const args = [...BASE, "-progress", "pipe:1", "-threads", "1", "-f", "concat", "-safe", "0", "-i", list];
  const graph = [];
  let n = 1;
  let v = "0:v";
  spec.overlays.forEach((o, oi) => {
    args.push("-i", local.overlays[oi]);
    graph.push(`[${v}][${n++}:v]overlay=${Math.round(o.x)}:${Math.round(o.y)}:enable='between(t,${r(o.start)},${r(o.end - 0.001)})'[o${oi}]`);
    v = `o${oi}`;
  });
  graph.push(`[${v}]format=yuv420p[vout]`);

  const mix = ["[0:a]"];
  spec.sounds.forEach((s, si) => {
    const src = local.sounds[si];
    if (!src.hasAudio || s.dur <= 0.05 || s.volume <= 0) return;
    args.push("-threads", "1", "-i", src.file);
    const f = [AF, `atrim=start=${r(s.start)}`, "asetpts=PTS-STARTPTS"];
    // A sound shorter than its bar loops back to its start point, like the preview.
    const rest = src.duration ? src.duration - s.start : null;
    if (rest && rest > 0.5 && rest < s.dur - 0.05) f.push(`aloop=loop=-1:size=${Math.round(rest * 48000)}`);
    f.push(`atrim=duration=${r(s.dur)}`, `volume=${r(s.volume)}`, `adelay=${Math.round(s.at * 1000)}:all=1`);
    graph.push(`[${n++}:a]${f.join(",")}[m${si}]`);
    mix.push(`[m${si}]`);
  });
  graph.push(mix.length > 1 ? `${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0,atrim=duration=${r(total)}[aout]` : `[0:a]${AF},atrim=duration=${r(total)}[aout]`);

  args.push(
    "-filter_complex", graph.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    // zerolatency: no lookahead buffers, about half the memory of plain veryfast (the file is a bit larger).
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(fps), "-threads", "2",
    "-c:a", "aac", "-b:a", "160k",
    "-t", String(r(total)),
    "-movflags", "+faststart",
    out,
  );
  return args;
}
