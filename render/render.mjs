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
/**
 * Intermediate pieces: fast, near-lossless, all identical so the concat demuxer can join them. Identical includes
 * the colour tags: a generated hook has none and phone clips say bt709, and when they changed mid-join ffmpeg rebuilt
 * the final pass's filters there, which reset every text's timing (no text after the hook) and dropped frames
 * (2026-11-03).
 */
const PIECE_OUT = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-threads", "1", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-f", "matroska"];

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

/** Straight-line lookup in a measured [slider, value] table (src/lib/adjust.ts measured). */
function measured(points, v) {
  const a = Math.max(points[0][0], Math.min(points[points.length - 1][0], v));
  const i = Math.max(0, points.findIndex(([x]) => x >= a) - 1);
  const [x0, y0] = points[i];
  const [x1, y1] = points[i + 1];
  return y0 + ((a - x0) / (x1 - x0)) * (y1 - y0);
}

/** Exposure power (src/lib/adjust.ts exposurePower). */
export const exposurePower = (v) => measured([[-50, 0.28], [-25, 0.44], [0, 1], [20, 1.57], [40, 2.33], [50, 2.95]], v);
/** Curve strength for a positive contrast value (src/lib/adjust.ts contrastGamma). */
export const contrastGamma = (c) => measured([[0, 1], [10, 1.22], [20, 1.46], [35, 1.94], [50, 3.1]], c);

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
  // Same numbers as the preview (src/lib/adjust.ts: exposureCurve, contrastCurve, tempGains), measured from CapCut.
  // ffmpeg also evaluates each expression for one value past the top (256): the max keeps pow's base from going negative.
  if (v.brightness) {
    const c = `'255-255*pow(max(255-val,0)/255,${r(exposurePower(v.brightness))})'`;
    out.push(`lutrgb=r=${c}:g=${c}:b=${c}`);
  }
  if (v.contrast < 0) {
    const c = `'111.5+(val-111.5)*${r(1 + Math.max(-50, v.contrast) / 125)}'`;
    out.push(`lutrgb=r=${c}:g=${c}:b=${c}`);
  } else if (v.contrast) {
    const g = r(contrastGamma(v.contrast));
    const p = r(0.44 * 255);
    const q = r(255 - 0.44 * 255);
    const c = `'if(lt(val,${p}),${p}*pow(val/${p},${g}),255-${q}*pow(max(255-val,0)/${q},${g}))'`;
    out.push(`lutrgb=r=${c}:g=${c}:b=${c}`);
  }
  if (v.saturation) {
    // CSS saturate(), the preview's own matrix (and the browser export's), in RGB: eq's YUV saturation differed.
    const s = 1 + v.saturation / 50, k = (w, own) => r(own ? w + (1 - w) * s : w - w * s);
    out.push(`colorchannelmixer=rr=${k(0.213, 1)}:rg=${k(0.715)}:rb=${k(0.072)}:gr=${k(0.213)}:gg=${k(0.715, 1)}:gb=${k(0.072)}:br=${k(0.213)}:bg=${k(0.715)}:bb=${k(0.072, 1)}`);
  }
  if (v.warmth) {
    const a = Math.abs(v.warmth) / 50;
    const [cr, cg, cb] = (v.warmth < 0 ? [0.81, 1.01, 1.52] : [1.7, 0.82, 0.21]).map((x) => r(1 + (x - 1) * a));
    out.push(`colorchannelmixer=rr=${cr}:gg=${cg}:bb=${cb}`);
  }
  return out;
}

/**
 * ffmpeg arguments for the preview copy of an uploaded video (server.mjs makePreview): short side 480 (never larger
 * than the source; founder 2026-11-03: smoothness over quality in the editor), at most 30 fps, a keyframe every
 * second so the editor seeks at once, well under 1 Mbps instead of ~46.
 */
export const previewArgs = (input, out, master) => {
  const fit = (n) => `scale=w='if(gt(iw,ih),-2,min(${n},iw))':h='if(gt(iw,ih),min(${n},ih),-2)'`;
  // Lean encoders when making both copies at once: one pass with default x264 threads peaked at 671 MB on a 4K
  // clip and the 512 MB render server restarted; single-threaded, no lookahead: 298 MB (2026-11-03).
  const lean = master ? ["-tune", "zerolatency", "-x264-params", "threads=1:lookahead-threads=1"] : [];
  const video = (crf) => ["-fpsmax", "30", "-c:v", "libx264", "-preset", "veryfast", ...lean, "-crf", String(crf), "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-pix_fmt", "yuv420p"];
  const audio = ["-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart"];
  if (!master) return ["-y", "-hide_banner", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-vf", fit(480), ...video(26), ...audio, out];
  // One decode of the original, two copies: the 480p preview and the export's working copy, cut to the export frame
  // (the centre 9:16 of the original at 1080x1920: what the export shows, as sharp as the original allows, and nothing
  // left for the export to crop or scale; founder 2026-11-03).
  const vertical = "crop='trunc(min(iw,ih*9/16)/2)*2':'trunc(min(ih,iw*16/9)/2)*2',scale=1080:1920";
  return ["-y", "-hide_banner", "-i", input, "-filter_complex", `[0:v:0]split=2[a][b];[a]${fit(480)}[p];[b]${vertical}[m]`,
    "-map", "[p]", "-map", "0:a:0?", ...video(26), ...audio, out,
    "-map", "[m]", "-map", "0:a:0?", ...video(18), ...audio, master];
};

/** The pieces to render, in order: black gaps and clip pieces, each with its on-screen length. */
export function plan(spec) {
  const steps = [];
  let seconds = 0, frames = 0;
  // Quantize the cumulative timeline, not each cut independently. Otherwise every fractional-frame cut rounds up
  // in its intermediate file and the final -t silently removes later clips. Sub-frame pieces may have no output frame.
  const add = (step, len) => {
    seconds += len;
    const end = Math.round(seconds * spec.fps);
    const count = end - frames;
    frames = end;
    if (count > 0) steps.push({ ...step, frames: count, len: count / spec.fps });
  };
  spec.segments.forEach((seg, si) => {
    if (seg.gap > 0) add({ kind: "gap" }, seg.gap);
    seg.pieces.forEach((p, pi) => add({ kind: "piece", si, pi, start: p.start, end: p.end }, Math.max(0.05, p.end - p.start) / seg.speed));
  });
  return steps;
}

/** One step of the plan to an intermediate file. */
export function stepArgs(spec, step, src, out) {
  const { width: W, height: H, fps } = spec;
  const frameOut = ["-r", String(fps), "-fps_mode", "cfr"];
  if (step.kind === "gap") {
    return [...BASE, "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${fps}:d=${step.len}`, "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`, "-t", String(step.len), "-vf", "format=yuv420p,setsar=1", ...PIECE_OUT, ...frameOut, out];
  }
  const seg0 = spec.segments[step.si];
  // A piece of a Cut clip may carry its own look and sound; Speed is always the clip's.
  const own = seg0.pieces[step.pi ?? 0] ?? {};
  const seg = { ...seg0, look: own.look ?? seg0.look, volume: own.volume ?? seg0.volume };
  const len = step.len;
  const v = [
    `trim=start=${r(step.start)}:end=${r(step.end)}`,
    "setpts=PTS-STARTPTS",
    // Cover the frame from the centre: crop the source to the frame's shape first, then scale. The same picture as
    // scaling up and cropping, without scaling the parts that are thrown away (a 4K landscape clip was scaled to
    // 3413x1920 per frame before; 2026-11-03).
    `crop='trunc(min(iw,ih*${W}/${H})/2)*2':'trunc(min(ih,iw*${H}/${W})/2)*2'`,
    `scale=${W}:${H}`,
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
  return [...BASE, "-threads", "1", "-i", src.file, "-filter_complex", `[0:v]${v.join(",")}[v];${a}`, "-map", "[v]", "-map", "[a]", "-t", String(len), ...PIECE_OUT, ...frameOut, out];
}

/**
 * The final pass: the joined pieces (a concat list), the texts on top, the sound mixed in.
 * @param {Spec} spec
 * @param {string} list  concat demuxer list of the step files
 * @param {{ sounds: Probe[], overlays: string[] }} local
 */
export function finalArgs(spec, list, local, out) {
  const { fps, total } = spec;
  // -reinit_filter 0: the joined pieces are all 720x1280 yuv420p; never rebuild the filters mid-video (see PIECE_OUT).
  const args = [...BASE, "-progress", "pipe:1", "-threads", "1", "-reinit_filter", "0", "-f", "concat", "-safe", "0", "-i", list];
  const graph = [];
  let n = 1;
  // Matroska timestamps have millisecond precision. Normalize the joined stream before overlay's shortest check,
  // so timestamp jitter cannot drop the final frame or end a later overlay one frame early.
  graph.push(`[0:v]fps=${fps},tpad=stop_mode=clone:stop_duration=1,trim=duration=${r(total)},setpts=PTS-STARTPTS[joined]`);
  let v = "joined";
  spec.overlays.forEach((o, oi) => {
    // A text image is one frame. As a plain input, overlay dropped later-starting texts on real clips (2026-10-24:
    // the second text never appeared), so it is repeated into a steady stream at the video's frame rate that ends
    // with it. The repeat happens inside the filter graph (loop filter), which makes a frame only when overlay asks:
    // as a looped input (-loop 1) ffmpeg read every text far ahead of the video and queued the frames, 2.8 GB for a
    // 22 s video with 13 texts on a 512 MB worker (2026-11-03: exports died at 69%).
    args.push("-i", local.overlays[oi]);
    // A second past the end: the video, not the text, decides where the export ends (shortest), so no frame is lost.
    graph.push(`[${n++}:v]loop=loop=-1:size=1,setpts=N/${fps}/TB,trim=duration=${r(total + 1)}[t${oi}]`);
    // On the same frames as the clips: plan() rounds every clip edge to a whole frame, so a text made for a clip
    // (2.715 s against a clip starting on frame 81, 2.700 s) starts and ends on that frame, not one frame late.
    const from = (Math.round(o.start * fps) - 0.5) / fps, to = (Math.round(o.end * fps) - 0.5) / fps;
    graph.push(`[${v}][t${oi}]overlay=${Math.round(o.x)}:${Math.round(o.y)}:shortest=1:enable='between(t,${r(from)},${r(to)})'[o${oi}]`);
    v = `o${oi}`;
  });
  graph.push(`[${v}]format=yuv420p[vout]`);

  const mix = ["[0:a]"];
  spec.sounds.forEach((s, si) => {
    const src = local.sounds[si];
    if (!src.hasAudio || s.dur <= 0.05 || s.volume <= 0) return;
    args.push("-threads", "1", "-i", src.file);
    const f = [AF, `atrim=start=${r(s.start)}`, "asetpts=PTS-STARTPTS"];
    // A sound shorter than its bar loops back to its start point, like the preview's soundAt: at least every 0.5 s,
    // silent past the file's end (a short tail used to play once and stop here while the preview looped it).
    const rest = src.duration ? src.duration - s.start : null;
    if (rest !== null && rest > 0 && rest < s.dur - 0.05) {
      const span = Math.max(0.5, rest);
      f.push(`apad=whole_dur=${r(span)}`, `atrim=duration=${r(span)}`, `aloop=loop=-1:size=${Math.round(span * 48000)}`);
    }
    f.push(`atrim=duration=${r(s.dur)}`, `volume=${r(s.volume)}`, `adelay=${Math.round(s.at * 1000)}:all=1`);
    graph.push(`[${n++}:a]${f.join(",")}[m${si}]`);
    mix.push(`[m${si}]`);
  });
  graph.push(mix.length > 1 ? `${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0,atrim=duration=${r(total)}[aout]` : `[0:a]${AF},atrim=duration=${r(total)}[aout]`);

  args.push(
    "-filter_complex", graph.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    // zerolatency: no lookahead buffers, low memory. ultrafast at crf 17: the join was the slowest part of a 1080x1920
    // export (55 s of 168 s on Vercel with veryfast); the file is larger, the picture as clean, and Reels re-encode
    // every upload anyway (2026-11-03).
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "17", "-pix_fmt", "yuv420p", "-r", String(fps), "-threads", "2",
    "-c:a", "aac", "-b:a", "160k",
    "-t", String(r(total)),
    "-movflags", "+faststart",
    out,
  );
  return args;
}
