/**
 * An upload's two copies made in the uploader's browser (founder 2026-11-23: a 4K iPhone clip waited 11-15 minutes for
 * the render server's copies on its half CPU). The same copies as the server's (render/render.mjs previewArgs):
 *   - preview: short side 480 (never larger than the source), at most 30 fps, a key frame every second (the editor
 *     seeks at once), H.264 + AAC.
 *   - master: the export's working copy, the centre 9:16 of the picture at exactly 1080x1920, at most 30 fps, a key frame
 *     every second, H.264 + AAC.
 * The browser decodes the clip ONCE with its (usually hardware) decoder, draws each frame to both sizes on the GPU and
 * encodes both copies at once, while the original uploads: 20 s of 4K iPhone HEVC in about 12 s in Chrome, against 64 s
 * through mediabunny's Conversion (one decode per copy, slow frame processing) and minutes on the server. When it cannot make them, the
 * render server does, exactly as before: HDR clips (they need the server's tone-map, render.mjs TONEMAP), clips with no
 * colour tags (Chrome guesses their colours differently from ffmpeg), video this
 * browser cannot decode (HEVC on some PCs), no H.264 / AAC encoder, clips over MAX_SECONDS, or any failure.
 * The plan is pure and tested (scripts/browser-copies-checks.cjs); the conversion runs in real Chrome
 * (scripts/browser/copies.sh).
 */
import { ALL_FORMATS, AudioSampleSink, AudioSampleSource, BlobSource, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output, VideoSampleSink, canEncodeAudio, canEncodeVideo } from "mediabunny";

/** Longest clip copied in the browser: both copies sit in memory until uploaded (~150 MB at 2 minutes; Codex). */
export const MAX_SECONDS = 120;
export const MASTER = { width: 1080, height: 1920, bitrate: 10_000_000 };
export const PREVIEW_SIDE = 480;
export const PREVIEW_BITRATE = 900_000;
export const AUDIO_BITRATE = 160_000;

export type SourceInfo = { width: number; height: number; fps: number; seconds: number; hdr: boolean; decodable: boolean; hasAudio: boolean; audioDecodable: boolean; colorTagged: boolean };
export type CopyPlan = { preview: { width: number; height: number }; cap: boolean };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** What the browser makes for this source, or why the server must (a short reason). */
export function copyPlan(s: SourceInfo): CopyPlan | { server: string } {
  if (!s.decodable) return { server: "cannot decode" };
  if (s.hdr) return { server: "HDR" };
  // A clip with no colour tags: Chrome guesses its colours differently from ffmpeg (greens came out darker), so the
  // server keeps them exactly as before. Phone clips are tagged.
  if (!s.colorTagged) return { server: "untagged colour" };
  if (!(s.width > 0 && s.height > 0)) return { server: "no size" };
  if (!(s.seconds > 0) || s.seconds > MAX_SECONDS) return { server: "length" };
  // Sound this browser cannot decode would come out silent: the server keeps it (Codex 2026-11-23).
  if (s.hasAudio && !s.audioDecodable) return { server: "cannot decode sound" };
  const short = Math.min(s.width, s.height), scale = Math.min(1, PREVIEW_SIDE / short);
  const preview = { width: even(s.width * scale), height: even(s.height * scale) };
  // Over 30 fps (averaged over the whole clip) is capped at 30, like the server's -fpsmax 30; an iPhone's ~30.4 fps
  // keeps every frame, as on the server (dropping one a second there put the copies a frame apart from the server's).
  return { preview, cap: s.fps > 30.5 };
}

/** Whether this browser has the encoders at all (checked before the upload starts, so the server is not held back). */
export function copiesPossible(): boolean {
  return typeof window !== "undefined" && typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined" && typeof AudioEncoder !== "undefined";
}

async function sourceInfo(input: Input): Promise<SourceInfo | null> {
  const video = await input.getPrimaryVideoTrack();
  if (!video) return null;
  const audio = await input.getPrimaryAudioTrack();
  const [width, height, decodable, hdr, seconds, color, stats] = await Promise.all([
    video.getDisplayWidth(), video.getDisplayHeight(), video.canDecode(), video.hasHighDynamicRange(), input.computeDuration(), video.getColorSpace(), video.computePacketStats(),
  ]);
  return { width, height, fps: stats.averagePacketRate, seconds, hdr, decodable, hasAudio: Boolean(audio), audioDecodable: Boolean(audio && (await audio.canDecode())), colorTagged: Boolean(color.matrix && color.primaries && color.transfer) };
}

/** One copy being written: its canvas (the frame at the copy's size), encoder and file. */
function copyOut(width: number, height: number, bitrate: number, hasAudio: boolean) {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("no canvas");
  const video = new CanvasSource(canvas, { codec: "avc", bitrate, keyFrameInterval: 1, hardwareAcceleration: "prefer-hardware" });
  output.addVideoTrack(video);
  const audio = hasAudio ? new AudioSampleSource({ codec: "aac", bitrate: AUDIO_BITRATE }) : null;
  if (audio) output.addAudioTrack(audio);
  return { target, output, ctx, video, audio };
}

/** Both copies of `file`, or null when the server should make them (see the top). Never throws. */
export async function makeCopies(file: File, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<{ preview: Blob; master: Blob } | null> {
  if (!copiesPossible()) return null;
  const outs: ReturnType<typeof copyOut>[] = [];
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const info = await sourceInfo(input);
    if (!info) return null;
    const plan = copyPlan(info);
    if ("server" in plan) return null;
    const ok = await canEncodeVideo("avc", { width: MASTER.width, height: MASTER.height, bitrate: MASTER.bitrate }) && (!info.hasAudio || (await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48000, bitrate: AUDIO_BITRATE })));
    if (!ok) return null;
    const master = copyOut(MASTER.width, MASTER.height, MASTER.bitrate, info.hasAudio);
    const preview = copyOut(plan.preview.width, plan.preview.height, PREVIEW_BITRATE, info.hasAudio);
    outs.push(master, preview);
    await Promise.all(outs.map((o) => o.output.start()));
    // The picture: decoded once; the master is the centre 9:16 (cover), the preview the whole picture (its plan keeps the
    // aspect). Rotation metadata is applied by drawWithFit. A capped clip keeps one frame per 1/30 s slot, on its own
    // timestamps (60 fps keeps every other frame, 50 fps 30 of them a second; Codex 2026-11-23).
    const track = (await input.getPrimaryVideoTrack())!;
    let slot = -1;
    for await (const sample of new VideoSampleSink(track).samples()) {
      try {
        signal?.throwIfAborted();
        const t = sample.timestamp;
        const s = Math.floor(t * 30 + 1e-6);
        if (t < 0 || (plan.cap && s <= slot)) continue;
        slot = s;
        // A kept frame lasts at least to the next slot (a 60 fps frame's own 1/60 s would end the clip early).
        const d = plan.cap ? Math.max(sample.duration, (s + 1) / 30 - t, 1 / 1000) : Math.max(sample.duration, 1 / 1000);
        sample.drawWithFit(master.ctx, { fit: "cover" });
        sample.drawWithFit(preview.ctx, { fit: "fill" });
        await Promise.all([master.video.add(t, d), preview.video.add(t, d)]);
        onProgress?.(Math.min(0.95, t / info.seconds));
      } finally {
        sample.close();
      }
    }
    // The sound, decoded once and encoded into both.
    const sound = info.hasAudio ? await input.getPrimaryAudioTrack() : null;
    if (sound) {
      for await (const sample of new AudioSampleSink(sound).samples()) {
        try {
          signal?.throwIfAborted();
          if (sample.timestamp >= 0) await Promise.all(outs.map((o) => o.audio!.add(sample)));
        } finally {
          sample.close();
        }
      }
    }
    await Promise.all(outs.map((o) => o.output.finalize()));
    onProgress?.(1);
    const blob = (o: typeof master) => {
      if (!o.target.buffer) throw new Error("no output");
      return new Blob([o.target.buffer], { type: "video/mp4" });
    };
    return { master: blob(master), preview: blob(preview) };
  } catch (error) {
    if (!signal?.aborted) console.error("browser copies", error);
    await Promise.all(outs.map((o) => o.output.cancel().catch(() => undefined)));
    return null;
  } finally {
    input.dispose();
  }
}

/** Uploads run one copy job at a time, in upload order (several 4K clips at once would starve the page). */
let chain: Promise<unknown> = Promise.resolve();
export function queueCopies(file: File, signal?: AbortSignal): Promise<{ preview: Blob; master: Blob } | null> {
  const job = chain.then(() => (signal?.aborted ? null : makeCopies(file, undefined, signal)));
  chain = job.catch(() => null);
  return job;
}
