"use client";
import { ALL_FORMATS, AudioBufferSource, BlobSource, BufferSource, BufferTarget, CanvasSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output, VideoSampleSink, canEncodeAudio, canEncodeVideo, type InputVideoTrack } from "mediabunny";
import { demoAt, exposurePower, contrastGamma, plan, type Look, type Spec } from "../../render/render.mjs";
import { frameSchedule, frameTimes, mediaOrigin } from "../../render/frames.mjs";

/**
 * Export in the user's browser (founder 2026-11-04: CapCut exports in seconds, so ours must not take minutes). The
 * very job the server would render (render/render.mjs: same plan, same frame choice, same look formulas, same text
 * timing), drawn with WebGL and encoded by the browser's own (usually hardware) H.264 encoder at 1080x1920.
 * Chrome and Edge only; anything unsupported throws and the export button falls back to the server export.
 */

export type BrowserText = { png: string; x: number; y: number; start: number; end: number };
const RATE = 48000;

/** Chrome or Edge with a working H.264 + AAC encoder at the export size. */
export async function browserExportSupported(width: number, height: number): Promise<boolean> {
  try {
    const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
    if (!brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand))) return false;
    if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined" || typeof AudioEncoder === "undefined" || typeof OffscreenCanvas === "undefined") return false;
    if (!new OffscreenCanvas(1, 1).getContext("webgl2")) return false;
    const [video, audio] = await Promise.all([
      canEncodeVideo("avc", { width, height, bitrate: 10e6 }),
      canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: RATE, bitrate: 160e3 }),
    ]);
    return video && audio;
  } catch {
    return false;
  }
}

// ---------- picture ----------

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

// The look in render.mjs order: cover crop, flip, zoom window, exposure, contrast, saturation, warmth.
const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex;
uniform int mode;          // 0 video, 1 text image
uniform vec4 crop;         // cover crop in display space: left, top, width, height (0..1)
uniform vec3 zoom;         // window left, window top, 1/zoom
uniform int flip, rot;
uniform float expo, contr, sat; uniform vec3 gains; uniform int useExpo, useContr;
float ex(float v) { return 1.0 - pow(max(1.0 - v, 0.0), expo); }
float co(float v) {
  if (contr < 0.0) return clamp(111.5 / 255.0 + (v - 111.5 / 255.0) * (1.0 + contr / 125.0), 0.0, 1.0);
  return v < 0.44 ? 0.44 * pow(v / 0.44, contr) : 1.0 - 0.56 * pow(max(1.0 - v, 0.0) / 0.56, contr);
}
void main() {
  if (mode == 1) { o = texture(tex, uv); return; }
  vec2 w = zoom.xy + uv * zoom.z;
  if (flip == 1) w.x = 1.0 - w.x;
  vec2 d = crop.xy + w * crop.zw;
  vec2 t = rot == 90 ? vec2(d.y, 1.0 - d.x) : rot == 180 ? 1.0 - d : rot == 270 ? vec2(1.0 - d.y, d.x) : d;
  vec3 c = texture(tex, t).rgb;
  if (useExpo == 1) c = vec3(ex(c.r), ex(c.g), ex(c.b));
  if (useContr == 1) c = vec3(co(c.r), co(c.g), co(c.b));
  float y = dot(c, vec3(0.213, 0.715, 0.072)); // CSS saturate(), as the preview draws it
  c = clamp(vec3(y) + (c - vec3(y)) * sat, 0.0, 1.0);
  o = vec4(clamp(c * gains, 0.0, 1.0), 1.0);
}`;

type GL = WebGL2RenderingContext;
function makeGl(canvas: OffscreenCanvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: true }) as GL | null;
  if (!gl) throw new Error("webgl2");
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "program");
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const texture = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  return { gl, u, texture, video: texture() };
}

/** Smooth (ease in-out) keyframe value at file time F, as curve() in render.mjs. */
function curveAt(keys: NonNullable<Look["keys"]>, k: "zoom" | "panX" | "panY", F: number) {
  if (F < keys[0].t) return keys[0][k];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (F < b.t) {
      const P = (F - a.t) / Math.max(0.001, b.t - a.t);
      return a[k] + (b[k] - a[k]) * P * P * (3 - 2 * P);
    }
  }
  return keys[keys.length - 1][k];
}

// ---------- sound ----------

/** Pitch-keeping speed change (WSOLA), as ffmpeg's atempo does on the server. */
export function tempo(chs: Float32Array[], speed: number): Float32Array[] {
  if (speed === 1 || !chs[0].length) return chs;
  const N = 2048, Hs = N / 2, Ha = Hs * speed, tol = 384, L = Hs;
  const len = chs[0].length, outLen = Math.ceil(len / speed);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const mono = new Float32Array(len);
  for (const c of chs) for (let i = 0; i < len; i++) mono[i] += c[i] / chs.length;
  const out = chs.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  let prev = 0;
  for (let m = 0; m * Hs < outLen; m++) {
    const target = Math.round(m * Ha);
    let best = target;
    if (m > 0) {
      const nat = prev + Hs;
      let score = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const at = target + d;
        if (at < 0 || at + L > len || nat + L > len) continue;
        let s = 0;
        for (let i = 0; i < L; i += 4) s += mono[at + i] * mono[nat + i];
        if (s > score) { score = s; best = at; }
      }
    }
    const o = m * Hs;
    for (let i = 0; i < N; i++) {
      const at = best + i;
      if (at >= len) break;
      const w = win[i];
      for (let c = 0; c < chs.length; c++) out[c][o + i] += chs[c][at] * w;
      norm[o + i] += w;
    }
    prev = best;
  }
  return out.map((c) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? c[i] / norm[i] : 0;
    return r;
  });
}

/**
 * A file's sound as stereo at 48 kHz, or null when the file has no sound. A sound that exists but can't be decoded
 * throws, so the export falls back to the server instead of finishing silent.
 */
async function decodeSound(blob: Blob): Promise<Float32Array[] | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack().then((t) => !!t, () => null);
  input.dispose();
  if (track === false) return null;
  const buf = await new OfflineAudioContext(2, RATE, RATE).decodeAudioData(await blob.arrayBuffer());
  const l = buf.getChannelData(0);
  if (buf.numberOfChannels > 1) return [l, buf.getChannelData(1)];
  // Mono to stereo at -3 dB per side, like ffmpeg's aformat on the server.
  const m = l.map((x) => x * Math.SQRT1_2);
  return [m, m];
}

// ---------- export ----------

const keyOf = (url: string) => url.split("?")[0];

/** What one export holds open, released however it ends. */
type Held = { output?: Output; inputs: Input[]; gl?: WebGL2RenderingContext; bitmaps: ImageBitmap[] };

/** Renders the spec to an MP4 in the browser. onProgress gets 0..1. Any failure throws (the server export takes over). */
export async function browserExport(spec: Spec, textsReady: BrowserText[] | Promise<BrowserText[]>, onProgress: (p: number) => void, signal?: AbortSignal): Promise<{ video: Blob; demo: Blob | null }> {
  const held: Held = { inputs: [], bitmaps: [] };
  try {
    return await render(spec, textsReady, onProgress, held, signal);
  } catch (error) {
    if (held.output && held.output.state !== "finalized") await held.output.cancel().catch(() => undefined);
    throw error;
  } finally {
    for (const input of held.inputs) input.dispose();
    for (const bitmap of held.bitmaps) bitmap.close();
    held.gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

async function render(spec: Spec, textsReady: BrowserText[] | Promise<BrowserText[]>, onProgress: (p: number) => void, held: Held, signal?: AbortSignal): Promise<{ video: Blob; demo: Blob | null }> {
  const { width: W, height: H, fps } = spec;
  const steps = plan(spec);
  const frameCount = Math.max(1, Math.round(spec.total * fps));
  // Where the demo starts (render.mjs demoAt): a key frame there lets its part be copied out as its own clip.
  const at = demoAt(spec), demoFrame = at === null ? -1 : Math.round(at * fps);

  // Download every file once, all at once; the picture starts as soon as the first clip is in.
  const blobs = new Map<string, Promise<Blob>>();
  for (const s of [...spec.segments, ...spec.sounds]) {
    const k = keyOf(s.url);
    if (blobs.has(k)) continue;
    const blob = fetch(s.url, { signal, cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      return res.blob();
    });
    blob.catch(() => undefined);
    blobs.set(k, blob);
  }
  const blobOf = (url: string) => blobs.get(keyOf(url))!;

  // Sound: every piece and sound mixed like the server's final pass (summed, no normalizing).
  const sounds = new Map<string, Promise<Float32Array[] | null>>();
  const soundOf = (url: string) => {
    const k = keyOf(url);
    if (!sounds.has(k)) sounds.set(k, blobOf(url).then(decodeSound));
    return sounds.get(k)!;
  };
  const total = Math.round(spec.total * RATE);
  const mix = [new Float32Array(total), new Float32Array(total)];
  const mixSound = async () => {
    let frame = 0;
    for (const st of steps) {
      const at = Math.round((frame / fps) * RATE), n = Math.round(st.len * RATE);
      frame += st.frames;
      if (st.kind !== "piece") continue;
      const seg = spec.segments[st.si!], own = seg.pieces[st.pi ?? 0] as { volume?: number };
      const volume = own.volume ?? seg.volume;
      if (volume <= 0) continue;
      const src = await soundOf(seg.url);
      if (!src) continue;
      const a = Math.max(0, Math.round(st.start! * RATE)), b = Math.min(src[0].length, Math.round(st.end! * RATE));
      if (b <= a) continue;
      const part = tempo(src.map((c) => c.subarray(a, b)), seg.speed);
      for (let c = 0; c < 2; c++) for (let i = 0; i < n && i < part[c].length && at + i < total; i++) mix[c][at + i] += part[c][i] * volume;
    }
    for (const s of spec.sounds) {
      if (s.dur <= 0.05 || s.volume <= 0) continue;
      const src = await soundOf(s.url);
      if (!src) continue;
      const start = Math.round(s.start * RATE), len = src[0].length;
      const rest = (len - start) / RATE;
      // Like the preview's soundAt: loop back to the start point, at least every 0.5 s (silence past the file's end).
      const loop = rest > 0 && rest < s.dur - 0.05 ? Math.round(Math.max(0.5, rest) * RATE) : 0;
      const at = Math.round(s.at * RATE), n = Math.round(s.dur * RATE);
      for (let c = 0; c < 2; c++) {
        for (let i = 0; i < n && at + i < total; i++) {
          const j = start + (loop ? i % loop : i);
          if (j >= len) { if (loop) continue; break; }
          mix[c][at + i] += src[c][j] * s.volume;
        }
      }
    }
  };

  // Picture.
  const canvas = new OffscreenCanvas(W, H);
  const { gl, u, texture, video } = makeGl(canvas);
  held.gl = gl;
  gl.viewport(0, 0, W, H);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1i(u("tex"), 0);
  const texts = await textsReady;
  const overlays = await Promise.all(texts.map(async (t) => {
    const img = await createImageBitmap(await (await fetch(t.png)).blob(), { premultiplyAlpha: "premultiply" });
    held.bitmaps.push(img);
    const tex = texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    // Same frames as finalArgs: from round(start*fps) to round(end*fps)-1.
    return { tex, x: Math.round(t.x), y: Math.round(t.y), w: img.width, h: img.height, from: Math.round(t.start * fps), to: Math.round(t.end * fps) - 1 };
  }));

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const picture = new CanvasSource(canvas, { codec: "avc", bitrate: 10e6, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: "aac", bitrate: 160e3 });
  output.addVideoTrack(picture, { frameRate: fps });
  output.addAudioTrack(audio);
  held.output = output;
  await output.start();

  let n = 0;
  const finish = async () => {
    // Texts on top, then one encoded frame.
    gl.uniform1i(u("mode"), 1);
    gl.enable(gl.BLEND);
    for (const o of overlays) {
      if (n < o.from || n > o.to) continue;
      gl.viewport(o.x, H - o.y - o.h, o.w, o.h);
      gl.bindTexture(gl.TEXTURE_2D, o.tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, W, H);
    gl.uniform1i(u("mode"), 0);
    // A lost GPU context draws nothing: stop rather than encode black frames.
    if (gl.isContextLost()) throw new Error("webgl context lost");
    await picture.add(n / fps, 1 / fps, n === demoFrame ? { keyFrame: true } : undefined);
    n++;
    onProgress(0.03 + (n / frameCount) * 0.92);
    signal?.throwIfAborted();
  };
  const black = async () => {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    await finish();
  };

  const inputs = new Map<string, { track: InputVideoTrack; first: number }>();
  const trackOf = async (url: string) => {
    const k = keyOf(url);
    let t = inputs.get(k);
    if (!t) {
      const input = new Input({ source: new BlobSource(await blobOf(url)), formats: ALL_FORMATS });
      held.inputs.push(input);
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new Error("decode");
      // File time as ffmpeg counts it (render/frames.mjs mediaOrigin).
      t = { track, first: await mediaOrigin(input) };
      inputs.set(k, t);
    }
    return t;
  };

  for (const st of steps) {
    if (st.kind !== "piece") {
      for (let k = 0; k < st.frames; k++) await black();
      continue;
    }
    const seg = spec.segments[st.si!];
    const own = seg.pieces[st.pi ?? 0] as { look?: Look | null };
    const look = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, zoom: 0, panX: 0, panY: 0, flip: false, keys: [] as NonNullable<Look["keys"]>, ...(own.look ?? seg.look ?? {}) };
    const keys = [...(look.keys ?? [])].sort((a, b) => a.t - b.t);
    const { track, first } = await trackOf(seg.url);
    const dw = track.displayWidth, dh = track.displayHeight;
    const cw = Math.min(dw, (dh * W) / H), ch = Math.min(dh, (dw * H) / W);
    gl.uniform4f(u("crop"), (dw - cw) / 2 / dw, (dh - ch) / 2 / dh, cw / dw, ch / dh);
    gl.uniform1i(u("flip"), look.flip ? 1 : 0);
    gl.uniform1i(u("rot"), ((track.rotation % 360) + 360) % 360);
    gl.uniform1i(u("useExpo"), look.brightness ? 1 : 0);
    gl.uniform1f(u("expo"), exposurePower(look.brightness));
    gl.uniform1i(u("useContr"), look.contrast ? 1 : 0);
    gl.uniform1f(u("contr"), look.contrast < 0 ? Math.max(-50, look.contrast) : contrastGamma(look.contrast));
    gl.uniform1f(u("sat"), 1 + look.saturation / 50);
    const wa = Math.abs(look.warmth) / 50;
    const g = (look.warmth < 0 ? [0.81, 1.01, 1.52] : [1.7, 0.82, 0.21]).map((x) => 1 + (x - 1) * wa);
    gl.uniform3f(u("gains"), ...((look.warmth ? g : [1, 1, 1]) as [number, number, number]));

    // The very frames stepArgs' ffmpeg chain picks (render/frames.mjs, checked against ffmpeg).
    const pts = await frameTimes(new EncodedPacketSink(track), first, st.start!, st.end!);
    const schedule = frameSchedule(pts, { start: st.start!, end: st.end!, frames: st.frames }, seg.speed, fps);
    const sink = new VideoSampleSink(track);
    const times = schedule.source.map((i) => (i < 0 ? -1 : first + pts[i]));
    const files = schedule.slot.map((j) => st.start! + j / fps);
    let k = 0, last: VideoFrame | null = null;
    for await (const sample of sink.samplesAtTimestamps(times)) {
      if (sample && times[k] >= 0) {
        last?.close();
        last = sample.toVideoFrame();
        sample.close();
      }
      const F = files[k];
      const z = 1 + (keys.length ? curveAt(keys, "zoom", F) : look.zoom) / 100;
      const px = keys.length ? curveAt(keys, "panX", F) : look.panX, py = keys.length ? curveAt(keys, "panY", F) : look.panY;
      gl.uniform3f(u("zoom"), ((1 - 1 / z) / 2) * (1 - px / 100), ((1 - 1 / z) / 2) * (1 - py / 100), 1 / z);
      if (last) {
        gl.bindTexture(gl.TEXTURE_2D, video);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, last);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        await finish();
      } else await black();
      k++;
    }
    last?.close();
  }
  // The server pads the video to its full length with the last frame.
  while (n < frameCount) await finish();
  picture.close();
  // The sound, once every file is in (the picture is already encoded).
  await mixSound();
  signal?.throwIfAborted();
  const sound = new AudioBuffer({ length: Math.max(1, total), numberOfChannels: 2, sampleRate: RATE });
  sound.copyToChannel(mix[0], 0);
  sound.copyToChannel(mix[1], 1);
  await audio.add(sound);
  audio.close();
  await output.finalize();
  onProgress(1);
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error("empty");
  const file = bt709(new Uint8Array(buffer));
  // The demo part: never a reason to fail the export.
  const demo = at === null ? null : await cutDemo(file, at, fps).catch(() => null);
  return { video: new Blob([file], { type: "video/mp4" }), demo };
}

/** The demo part of the finished video (from its key frame at `at`), picture only, packets copied as they are. */
async function cutDemo(file: Uint8Array<ArrayBuffer>, at: number, fps: number): Promise<Blob | null> {
  const input = new Input({ source: new BufferSource(file.buffer), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const packets = new EncodedPacketSink(track);
    const key = await packets.getKeyPacket(at + 0.25 / fps);
    if (!key || Math.abs(key.timestamp - at) > 0.5 / fps) return null;
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const source = new EncodedVideoPacketSource("avc");
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    const decoderConfig = (await track.getDecoderConfig()) ?? undefined;
    let first = true;
    for await (const p of packets.packets(key)) {
      await source.add(p.clone({ timestamp: p.timestamp - key.timestamp }), first && decoderConfig ? { decoderConfig } : undefined);
      first = false;
    }
    source.close();
    await output.finalize();
    const out = (output.target as BufferTarget).buffer;
    return out ? new Blob([bt709(new Uint8Array(out))], { type: "video/mp4" }) : null;
  } finally {
    input.dispose();
  }
}

/**
 * The browser labels a canvas video's colour curve sRGB; the server's videos (and the clips) say BT.709, and some
 * players (QuickTime, iPhone) show the two a little differently. Relabel the file's colour box to BT.709.
 */
function bt709(file: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  // 'colr' + 'nclx', then primaries, transfer, matrix (16 bits each).
  for (let i = 0; i + 14 < file.length; i++) {
    if (file[i] === 0x63 && file[i + 1] === 0x6f && file[i + 2] === 0x6c && file[i + 3] === 0x72 && file[i + 4] === 0x6e && file[i + 5] === 0x63 && file[i + 6] === 0x6c && file[i + 7] === 0x78) {
      file[i + 10] = 0;
      file[i + 11] = 1;
      break;
    }
  }
  return file;
}
