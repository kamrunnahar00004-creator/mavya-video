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

/** Smooth (ease in-out) value of keyframe field `k` at file time `at` + p0, as an ffmpeg expression. */
function curve(keys, k, p0, at = "it") {
  const F = `(${at}+${r(p0)})`;
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
    // The zoom window's corners in the input, to the fraction of a pixel: perspective resamples (bilinear) from
    // them. zoompan snapped the window to whole pixels, so a keyframed zoom wobbled 1-2 px every frame (founder
    // 2026-11-11: "when it is zooming, it is shaking"); the browser export never did. One output frame per input
    // frame; `in` counts frames from 1 and the input is already at `fps`, so slot j = in - 1 is at file time
    // j / fps + p0 (in / fps ran one frame early, measured 2026-11-11).
    const at = `(in-1)/${fps}`;
    const z = `(1+(${curve(keys, "zoom", p0, at)})/100)`;
    const left = `((W-W/${z})/2*(1-(${curve(keys, "panX", p0, at)})/100))`;
    const top = `((H-H/${z})/2*(1-(${curve(keys, "panY", p0, at)})/100))`;
    const right = `(${left}+W/${z})`, bottom = `(${top}+H/${z})`;
    out.push(`perspective=x0='${left}':y0='${top}':x1='${right}':y1='${top}':x2='${left}':y2='${bottom}':x3='${right}':y3='${bottom}':interpolation=linear:sense=source:eval=frame`);
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
 * HDR (HLG or PQ) to SDR BT.709, for the copies of an HDR upload (iPhones film HDR by default). Without it the 10-bit
 * BT.2020 picture lands in an 8-bit BT.709 file unconverted and looks flat and washed out. Runs after the copy is
 * scaled down, so the float frames stay small (25 MB at 1080x1920, not 100 MB at 4K) on the 512 MB render server.
 * Hable with npl=140, measured against what Chrome shows for the same iPhone clips (founder 2026-11-11: "it had the perfect
 * color and while editing the color just bursted": the editor had switched from the original to this copy). The old
 * mobius at npl=100 doubled the brightness of HLG mid-grey (Y 141 where Chrome shows 78) and blew out three real iPhone
 * clips by ~40 levels; hable at npl=140 is within 11 levels of Chrome on the BT.2408 reference levels and within 2 on
 * the average of those clips (scripts/hdr-tonemap-checks.mjs). The 2026-11-05 test that picked mobius used an HLG clip
 * made from an SDR one, which sits far darker than iPhone footage.
 */
export const TONEMAP = "zscale=t=linear:npl=140,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
/** HDR from ffmpeg's stream line, e.g. "yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67)". */
export const isHdr = (probeText) => /Video:.*\b(arib-std-b67|smpte2084)\b/.test(probeText);

/**
 * ffmpeg arguments for the preview copy of an uploaded video (server.mjs makePreview): short side 480 (never larger
 * than the source; founder 2026-11-03: smoothness over quality in the editor), at most 30 fps, a keyframe every
 * second so the editor seeks at once, well under 1 Mbps instead of ~46. `hdr`: tone-map to SDR (TONEMAP).
 */
export const previewArgs = (input, out, master, hdr = false) => {
  const fit = (n) => `scale=w='if(gt(iw,ih),-2,min(${n},iw))':h='if(gt(iw,ih),min(${n},ih),-2)'`;
  const tm = hdr ? `,${TONEMAP}` : "";
  // Lean encoders when making both copies at once: one pass with default x264 threads peaked at 671 MB on a 4K
  // clip and the 512 MB render server restarted; single-threaded, no lookahead: 298 MB (2026-11-03).
  const lean = master ? ["-tune", "zerolatency", "-x264-params", "threads=1:lookahead-threads=1"] : [];
  const video = (crf) => ["-fpsmax", "30", "-c:v", "libx264", "-preset", "veryfast", ...lean, "-crf", String(crf), "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-pix_fmt", "yuv420p", ...(hdr ? ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"] : [])];
  const audio = ["-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart"];
  if (!master) return ["-y", "-hide_banner", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-vf", fit(480) + tm, ...video(26), ...audio, out];
  // One decode of the original, two copies: the 480p preview and the export's working copy, cut to the export frame
  // (the centre 9:16 of the original at 1080x1920: what the export shows, as sharp as the original allows, and nothing
  // left for the export to crop or scale; founder 2026-11-03).
  const vertical = "crop='trunc(min(iw,ih*9/16)/2)*2':'trunc(min(ih,iw*16/9)/2)*2',scale=1080:1920";
  return ["-y", "-hide_banner", "-i", input, "-filter_complex", `[0:v:0]split=2[a][b];[a]${fit(480)}${tm}[p];[b]${vertical}${tm}[m]`,
    "-map", "[p]", "-map", "0:a:0?", ...video(26), ...audio, out,
    "-map", "[m]", "-map", "0:a:0?", ...video(18), ...audio, master];
};

/**
 * The ffmpeg runs that make an upload's copies. SDR: one pass (previewArgs). HDR: the two copies one after the other,
 * each decoding with one thread: 4K 10-bit HEVC decode plus the float tone-map peaked at 579 MB in one pass with two
 * decoder threads, 410 MB with one, and 364 MB per copy when run separately (2026-11-05), under the 512 MB server.
 */
export const previewRuns = (input, out, master, hdr = false) => {
  if (!hdr) return [previewArgs(input, out, master)];
  const one = (args) => { const i = args.indexOf("-i"); return [...args.slice(0, i), "-threads", "1", ...args.slice(i)]; };
  return [one(previewArgs(input, out, undefined, true)), ...(master ? [one(masterArgs(input, master))] : [])];
};
/** The working copy alone (HDR uploads: tone-mapped, see previewRuns). */
const masterArgs = (input, master) => {
  const vertical = "crop='trunc(min(iw,ih*9/16)/2)*2':'trunc(min(ih,iw*16/9)/2)*2',scale=1080:1920";
  return ["-y", "-hide_banner", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-vf", `${vertical},${TONEMAP}`,
    "-fpsmax", "30", "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-x264-params", "threads=1:lookahead-threads=1",
    "-crf", "18", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart", master];
};

/** The pieces to render, in order: black gaps and clip pieces, each with its on-screen length. */
export function plan(spec) {
  return layout(spec).steps;
}

/**
 * The finished video's exact length: plan()'s frames over the frame rate. The editor adds clip lengths in another
 * order and can land one frame off (4.0167 s against 121 frames), so the export uses this, not the editor's sum, for
 * its total: the picture and the sound then end together on the last frame in both export lanes.
 */
export const planLength = (spec) => plan(spec).reduce((n, st) => n + st.frames, 0) / spec.fps;

/**
 * plan()'s steps plus where each segment sits: its empty space before it (`gap`) and its clip (`clip`), each as
 * output frames [from, to) and as the timeline seconds plan() added up (in plan's own order, so they round the same).
 */
export function layout(spec) {
  const steps = [];
  const segs = [];
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
    const gap = { from: frames, start: seconds };
    if (seg.gap > 0) add({ kind: "gap" }, seg.gap);
    const clip = { from: frames, start: seconds };
    seg.pieces.forEach((p, pi) => add({ kind: "piece", si, pi, start: p.start, end: p.end }, Math.max(0.05, p.end - p.start) / seg.speed));
    segs.push({ gap: { ...gap, to: clip.from, end: clip.start }, clip: { ...clip, to: frames, end: seconds } });
  });
  return { steps, segs };
}

/**
 * The output frames [from, to) a text shows on (founder 2026-11-07: a caption stays inside its own clip, 100% of the
 * time). The text belongs to the clip (or the empty space) its start lies in, and shows only on that clip's frames as
 * plan() made them, never one frame on a neighbour. Clip edges come from plan()'s own sums, which can differ from the
 * editor's in the last digit (3.6675 against 3.6674999999999995), so a start within 1 ms before an edge belongs to the
 * clip starting there (as the preview's showsAt judges it), a text starting within 1 ms of its clip's start starts on
 * its first frame, and one ending within 1 ms of its clip's end ends on its last frame. A text starting outside every
 * clip and space (before 0, past the end) keeps its plain rounded frames. `text.owner` (from the editor, see
 * src/lib/edit.ts textOwner) decides the clip when given; null means outside every clip. Both export lanes use this.
 */
export function textFrames(spec, layoutOrNull, text) {
  const { fps } = spec;
  const segs = (layoutOrNull ?? layout(spec)).segs;
  // The editor's own judgement when it sent one (src/lib/edit.ts textOwner; Codex 2026-11-07: judging again from
  // plan()'s sums could hand a text on a clip's last millisecond to the next clip and show it nowhere).
  const told = text.owner && segs[text.owner.seg] ? segs[text.owner.seg][text.owner.gap ? "gap" : "clip"] : undefined;
  const own = text.owner === null ? undefined : told ?? segs.flatMap((s) => [s.gap, s.clip]).find((r) => text.start >= r.start - 0.001 && text.start < r.end - 0.001);
  let from = Math.round(text.start * fps), to = Math.round(text.end * fps);
  if (!own) return { from, to };
  if (text.start <= own.start + 0.001) from = own.from;
  if (text.end >= own.end - 0.001) to = own.to;
  from = Math.min(Math.max(from, own.from), own.to);
  to = Math.min(Math.max(to, from), own.to);
  return { from, to };
}

/**
 * Where the demo starts in the finished video (seconds, on a frame): after the hook's pieces, the first segment. Every
 * export also saves its demo part as its own clip (My files, Demos), cut from there without re-encoding. null when
 * the video has no demo.
 */
export function demoAt(spec) {
  const steps = plan(spec);
  const i = steps.findIndex((st) => st.kind === "gap" || (st.si ?? 0) > 0);
  if (i <= 0) return null;
  const frames = steps.slice(0, i).reduce((a, st) => a + st.frames, 0);
  return frames > 0 && frames < Math.round(spec.total * spec.fps) ? frames / spec.fps : null;
}

/** The demo part of a finished export: from its key frame at `at` to the end, picture only, copied as it is. */
export const demoArgs = (input, out, at) => [...BASE, "-ss", String(at), "-i", input, "-map", "0:v:0", "-c", "copy", "-movflags", "+faststart", out];

/**
 * Counts a piece's frames after the first frame-rate pass (trim, fps): the `slots` stepArgs spreads over the piece's
 * planned frames. A second stream counts the file's frames before the piece's start, for a piece with no frame of its
 * own (it holds the last of them, stepArgs). Writes one framecrc line per frame to `out`; read it with countFrames.
 */
export function countArgs(spec, step, src, out) {
  // Each stream ends with one marker frame (countFrames does not count it): ffmpeg cannot open an output stream that
  // never gets a frame, and either count may be 0.
  const mark = (k) => `color=c=black:s=2x2:r=${spec.fps}:d=${r(1 / spec.fps)},format=yuv420p,setsar=1[m${k}]`;
  const tail = "scale=2:2,format=yuv420p,setsar=1";
  return [...BASE, "-threads", "1", "-i", src.file, "-filter_complex", `[0:v:0]split=3[a][b][c];[a]trim=start=${r(step.start)}:end=${r(step.end)},setpts=PTS-STARTPTS,fps=${spec.fps},${tail}[a1];${mark(0)};[a1][m0]concat=n=2:v=1:a=0[in];[b]trim=end=${r(step.start)},setpts=PTS-STARTPTS,${tail}[b1];${mark(1)};[b1][m1]concat=n=2:v=1:a=0[before];[c]trim=end=${r(step.end)},setpts=PTS-STARTPTS,${tail}[c1];${mark(2)};[c1][m2]concat=n=2:v=1:a=0[upto]`, "-map", "[in]", "-map", "[before]", "-map", "[upto]", "-fps_mode", "passthrough", "-f", "framecrc", out];
}
/**
 * A countArgs file read as stepArgs' `slots`: the piece's own frame count after the frame-rate pass. When that is 0
 * (a cut between two source frames; or one so short its only frames are dropped by the frame-rate pass, Codex
 * 2026-11-07 at 120 fps; or past the file's end), minus (k + 1), where k is the frame stepArgs holds, counted from the
 * file's start: the first frame inside the piece if it has one, else the last before it. 0: no frame at all (black).
 * Throws on anything that is not a framecrc frame line.
 */
export const countFrames = (text) => {
  const n = [0, 0, 0];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const m = /^\s*([012]),\s*-?\d+,\s*-?\d+,\s*\d+,\s*\d+,\s*0x[0-9a-f]+/.exec(line);
    if (!m) throw new Error("bad frame count");
    n[+m[1]]++;
  }
  // Less each stream's marker frame (countArgs); a file without all three markers is not a count.
  if (n.some((x) => x < 1)) throw new Error("bad frame count");
  const [inside, before, upto] = n.map((x) => x - 1);
  if (inside > 0) return inside;
  const k = upto > before ? before : before - 1;
  return -(k + 1);
};

/** Whether a piece step uses its clip's own sound (then the caller makes it with pieceSoundArgs and fillSoundFile). */
export function pieceHasSound(spec, step, src) {
  if (step.kind !== "piece" || !src?.hasAudio) return false;
  const seg = spec.segments[step.si], own = seg.pieces[step.pi ?? 0] ?? {};
  return (own.volume ?? seg.volume) > 0;
}

/**
 * A piece's own sound, cut to the piece (never past its end), as raw 48 kHz stereo f32le: render/sound-file.mjs
 * fillSoundFile then stretches it to exactly the piece's planned length with the browser's own code
 * (render/sound.mjs), so both lanes make the same sound (Codex 2026-11-06: ffmpeg atempo ran up to 17 ms short and
 * apad filled the gap with silence).
 */
export function pieceSoundArgs(step, src, out) {
  return [...BASE, "-threads", "1", "-i", src.file, "-map", "0:a:0", "-af", `atrim=start=${r(step.start)}:end=${r(step.end)},asetpts=PTS-STARTPTS,${AF}`, "-f", "f32le", "-ac", "2", "-ar", "48000", out];
}

/**
 * One step of the plan to an intermediate file. `slots`: countFrames of the piece's countArgs file (a negative
 * number: no source frame inside the piece, it holds the frame on screen at its start; 0: nothing to show, black).
 * `sound`: the fillSoundFile output when pieceHasSound.
 */
export function stepArgs(spec, step, src, out, slots, sound) {
  const { width: W, height: H, fps } = spec;
  const frameOut = ["-r", String(fps), "-fps_mode", "cfr"];
  if (step.kind === "gap") {
    return [...BASE, "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${fps}:d=${step.len}`, "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`, "-t", String(step.len), "-vf", "format=yuv420p,setsar=1", ...PIECE_OUT, ...frameOut, out];
  }
  if (!Number.isInteger(slots)) throw new Error("piece frame count missing");
  const hasSound = pieceHasSound(spec, step, src);
  if (hasSound && !sound) throw new Error("piece sound missing");
  if (slots === 0) {
    // Nothing to show (no frame inside the piece and none before it): black for exactly its length, with its own
    // sound kept, as the browser does (Codex 2026-11-06).
    if (!hasSound) return stepArgs(spec, { kind: "gap", frames: step.frames, len: step.len }, null, out);
    const vol = spec.segments[step.si].pieces[step.pi ?? 0]?.volume ?? spec.segments[step.si].volume;
    return [...BASE, "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${fps}:d=${step.len}`, "-f", "f32le", "-ar", "48000", "-ch_layout", "stereo", "-i", sound,
      "-filter_complex", `[0:v]format=yuv420p,setsar=1[v];[1:a]volume=${r(vol)},${AF},apad,atrim=duration=${step.len},asetpts=PTS-STARTPTS[a]`,
      "-map", "[v]", "-map", "[a]", "-t", String(step.len), ...PIECE_OUT, ...frameOut, out];
  }
  const seg0 = spec.segments[step.si];
  // A piece of a Cut clip may carry its own look and sound; Speed is always the clip's.
  const own = seg0.pieces[step.pi ?? 0] ?? {};
  const seg = { ...seg0, look: own.look ?? seg0.look, volume: own.volume ?? seg0.volume };
  const len = step.len;
  // No source frame starts inside the piece (a cut shorter than the gap between two frames, Codex 2026-11-07: these
  // showed black, a flash at the join): one frame, picked by its number in the file (countFrames: the first inside
  // the piece, else the one on screen at its start), no buffering, held for the piece's length. render/frames.mjs
  // frameSchedule mirrors this.
  const held = slots < 0;
  const v = [
    held ? `trim=end=${r(step.end)}` : `trim=start=${r(step.start)}:end=${r(step.end)}`,
    "setpts=PTS-STARTPTS",
    ...(held ? [`select='eq(n,${-slots - 1})'`, "setpts=PTS-STARTPTS"] : []),
    // Cover the frame from the centre: crop the source to the frame's shape first, then scale. The same picture as
    // scaling up and cropping, without scaling the parts that are thrown away (a 4K landscape clip was scaled to
    // 3413x1920 per frame before; 2026-11-03).
    `crop='trunc(min(iw,ih*${W}/${H})/2)*2':'trunc(min(ih,iw*${H}/${W})/2)*2'`,
    `scale=${W}:${H}`,
    "setsar=1",
    // One frame rate before the look: the keyframed look reads each frame's slot at `fps`. A held frame is one frame
    // already (fps could drop it: at 120 fps it lasts under half an output frame, Codex 2026-11-07).
    ...(held ? ["format=yuv420p"] : [`fps=${fps}`]),
    ...look(seg.look, step.start, W, H, fps),
    // Spread the piece's own frames evenly over its planned frames: output n shows frame floor(n * slots / frames).
    // setpts gives frame j the time ceil(j * frames / slots) in whole frames and fps keeps the last frame per time.
    // The speed is the clip's, adjusted by under a frame for the timeline's rounding; the old setpts=PTS/speed
    // truncated to whole frames, ran 1-2 frames short and held the last frame at the cut (founder 2026-11-06: clips
    // join like CapCut's magnet, never showing trimmed-out frames). render/frames.mjs frameSchedule mirrors this.
    `settb=1/${fps}`,
    // A held frame is repeated to the piece's planned frames, one per output frame.
    ...(held ? [`loop=loop=${step.frames - 1}:size=1:start=0`, "setpts=N"] : [`setpts='ceil(N*${step.frames}/${slots})'`, `fps=${fps}`]),
    "format=yuv420p",
    // Exactly the planned length (texts are timed to it), even if the file ends early.
    `tpad=stop_mode=clone:stop_duration=${len}`,
    `trim=duration=${len}`,
    "setpts=PTS-STARTPTS",
  ];
  // The sound is already exactly the piece's length (fillSoundFile); apad/atrim only guard the sample count.
  const a = hasSound
    ? `[1:a]${[`volume=${r(seg.volume)}`, AF, "apad", `atrim=duration=${len}`, "asetpts=PTS-STARTPTS"].join(",")}[a]`
    : `anullsrc=r=48000:cl=stereo,atrim=duration=${len},${AF}[a]`;
  return [...BASE, "-threads", "1", "-i", src.file, ...(hasSound ? ["-f", "f32le", "-ar", "48000", "-ch_layout", "stereo", "-i", sound] : []), "-filter_complex", `[0:v]${v.join(",")}[v];${a}`, "-map", "[v]", "-map", "[a]", "-t", String(len), ...PIECE_OUT, ...frameOut, out];
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
  // Timestamps from frame numbers first: each piece has exactly its planned frames, but its file's length is saved in
  // whole milliseconds and the concat demuxer adds those up, so over many short pieces the joined times drift (Codex
  // 2026-11-07: 150 one-frame pieces, 26 frames showed the wrong clip and a caption sat over the next clip).
  graph.push(`[0:v]settb=1/${fps},setpts=N,fps=${fps},tpad=stop_mode=clone:stop_duration=1,trim=duration=${r(total)},setpts=PTS-STARTPTS[joined]`);
  // The sound likewise from its sample count: every piece's sound is exactly its planned samples (stepArgs).
  graph.push(`[0:a]asetpts=N/SR/TB,${AF}[base]`);
  let v = "joined";
  const where = layout(spec);
  spec.overlays.forEach((o, oi) => {
    // A text image is one frame. As a plain input, overlay dropped later-starting texts on real clips (2026-10-24:
    // the second text never appeared), so it is repeated into a steady stream at the video's frame rate that ends
    // with it. The repeat happens inside the filter graph (loop filter), which makes a frame only when overlay asks:
    // as a looped input (-loop 1) ffmpeg read every text far ahead of the video and queued the frames, 2.8 GB for a
    // 22 s video with 13 texts on a 512 MB worker (2026-11-03: exports died at 69%).
    args.push("-i", local.overlays[oi]);
    // A second past the end: the video, not the text, decides where the export ends (shortest), so no frame is lost.
    graph.push(`[${n++}:v]loop=loop=-1:size=1,setpts=N/${fps}/TB,trim=duration=${r(total + 1)}[t${oi}]`);
    // On its own clip's frames only (textFrames): a text made for a clip starts and ends on that clip's first and
    // last frame, never one frame late and never on the next clip.
    const f = textFrames(spec, where, o);
    const from = (f.from - 0.5) / fps, to = (f.to - 0.5) / fps;
    graph.push(`[${v}][t${oi}]overlay=${Math.round(o.x)}:${Math.round(o.y)}:shortest=1:enable='between(t,${r(from)},${r(to)})'[o${oi}]`);
    v = `o${oi}`;
  });
  graph.push(`[${v}]format=yuv420p[vout]`);

  const mix = ["[base]"];
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
  graph.push(mix.length > 1 ? `${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0,atrim=duration=${r(total)}[aout]` : `[base]atrim=duration=${r(total)}[aout]`);

  args.push(
    "-filter_complex", graph.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    // zerolatency: no lookahead buffers, low memory. ultrafast at crf 17: the join was the slowest part of a 1080x1920
    // export (55 s of 168 s on Vercel with veryfast); the file is larger, the picture as clean, and Reels re-encode
    // every upload anyway (2026-11-03).
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "17", "-pix_fmt", "yuv420p", "-r", String(fps), "-threads", "2",
    // A key frame where the demo starts, so its part can be copied out without re-encoding (demoArgs).
    ...(demoAt(spec) !== null ? ["-force_key_frames", String(r(demoAt(spec)))] : []),
    "-c:a", "aac", "-b:a", "160k",
    "-t", String(r(total)),
    "-movflags", "+faststart",
    out,
  );
  return args;
}
