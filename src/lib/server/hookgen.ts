import "server-only";
import { checkBudget, withWorkBudget, workSignal } from "@/lib/server/work-budget";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ffmpegPath } from "@/lib/server/ffmpeg";
import { faceRef } from "@/lib/server/face-ref";
import { putObject, signedGet } from "@/lib/server/r2";
import { libraryFile, mediaToFile } from "@/lib/server/store";
import type { Reference, Run } from "@/lib/types";
import { finishArgs, minSideFilter, parseTask, slowFactor, withLength, withSlow } from "@/lib/short-hook";

/**
 * Hook generation. Character swap on Kling 4.0 (founder decision 2026-11-21, after testing Kling 3.0 motion control,
 * Kling 4.0, Kling 4.0 Flash, Higgsfield Genjutsu and Wan side by side on 7 library hooks: "it cannot be better than
 * kling 4.0 with face ref"). Replaces 2026-10-23's Gemini first frame + Kling 3.0 motion control (about 150-220 s).
 *
 * A hook with a video (a library hook or an uploaded one): fal.ai Kling 4.0 video edit swaps the person in the clip
 * for the character, keeping the clip's own motion, timing, expressions, framing, clothes and room.
 *   References: the character's FACE (head and hair, face-ref.ts) first, then the whole photo. The face is what makes
 *   it work: with only the whole photo, Kling copied the photo's room and outfit into the hook.
 *   Same for a library character and an uploaded photo. A character described in words goes in the prompt instead.
 *   ~$0.157 per second of the clip, about 65-120 s. Runs as a background job (generation-jobs.ts).
 *   Kling 4.0 Flash was rejected: the result stays too close to the original creator.
 * Fallback (the job's one automatic retry): the same request again.
 * A described hook (no video): Kling v3 Standard image-to-video from the character photo, or text-to-video when the
 * character is described in words.
 * The result: no sound (Kling 4.0 adds its own audio), cut back to the clip's length (it rounds up to whole seconds),
 * a slowed short clip sped back up (short-hook.ts). Never the original's captions: Mavya adds the product's own text.
 */
const FAL = "https://queue.fal.run";
/** Kling 4.0 video edit: the clip plus reference images, the person swapped (founder 2026-11-21). */
export const SWAP = "kling/v4/video-to-video/edit";
const IMAGE_TO_VIDEO = "fal-ai/kling-video/v3/standard/image-to-video";
const TEXT_TO_VIDEO = "fal-ai/kling-video/v3/standard/text-to-video";
/** Length of a described hook (no original clip to follow). */
export const DESCRIBED_SECONDS = 5;
/** Shortest clip that is swapped (a shorter one is slowed past the task id's limit, short-hook.ts). */
const MIN_CLIP = 1;
/** Kling needs a few seconds of reference motion; shorter library cuts hold their last frame to reach it. */
const MIN_REFERENCE = 3;
/** Provider links (frames, clips) are read by fal within minutes; give them a day for queues. */
const LINK_SECONDS = 24 * 3600;

const LOOK = "Real handheld phone selfie video, casual UGC, one continuous take. Natural five-finger hands. No text, captions, subtitles, stickers or watermarks anywhere on screen.";
/**
 * The swap prompt, as tested and won (founder 2026-11-21), with "woman" made "person" so men swap too. @Image1 is the
 * face, @Image2 the whole photo of the same person.
 */
export const SWAP_PROMPT =
  "Replace the person in @Video1 with the person in @Image1. Their face and hair must match @Image1 (@Image2 shows the same person). Keep everything else from @Video1 exactly: the motion, timing, facial expressions, head turns, framing, clothes and room. Do not add any text.";
/** A character described in words: no photo, the description takes @Image1's place. */
export const swapPromptFor = (words: string) =>
  `Replace the person in @Video1 with ${words}. Keep everything else from @Video1 exactly: the motion, timing, facial expressions, head turns, framing, clothes and room. Do not add any text.`;
const NEGATIVE = "text, captions, subtitles, watermark, logo, cut, scene change, extra fingers, deformed hands, distorted face, morphing, exaggerated expressions, overacting";

const exec = promisify(execFile);
const ff = async (...args: string[]) => exec(await ffmpegPath(), ["-nostdin", "-v", "error", "-y", ...args], { timeout: 60_000, signal: workSignal(60_000) });

/** A lost create response may represent paid work. Never blindly replay it or launch a fallback. */
export class HookStartUncertain extends Error {}

const falKey = () => {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");
  return key;
};
const falHeaders = () => ({ Authorization: `Key ${falKey()}`, "content-type": "application/json" });

/** Queue one fal request; the task id carries the model so it can be polled later ("<model>|<request id>"). */
async function falSubmit(model: string, input: Record<string, unknown>): Promise<string> {
  checkBudget();
  const headers = falHeaders();
  let res: Response;
  try {
    res = await fetch(`${FAL}/${model}`, { method: "POST", headers, body: JSON.stringify(input), signal: workSignal(60_000) });
  } catch {
    throw new HookStartUncertain("Provider task acceptance is unknown");
  }
  if (res.status >= 500) throw new HookStartUncertain("Provider task acceptance is unknown");
  const body = (await res.json().catch(() => null)) as { request_id?: string; detail?: unknown } | null;
  if (res.ok && (!body?.request_id || !/^[\w-]+$/.test(body.request_id))) throw new HookStartUncertain("Provider task identity is unknown");
  if (!res.ok || !body?.request_id) throw new Error(`fal ${res.status}: ${JSON.stringify(body?.detail ?? body).slice(0, 300)}`);
  return `${model}|${body.request_id}`;
}

/** Temporary file for the provider to read (R2 tmp/, a signed link). */
async function share(bytes: Buffer, ext: "jpg" | "mp4", user: string): Promise<string> {
  checkBudget();
  const key = `tmp/gen/${randomUUID()}.${ext}`;
  const { error } = await createSupabaseAdminClient().from("temporary_objects").insert({ key, user_id: user });
  if (error) throw error;
  await putObject(key, bytes, ext === "jpg" ? "image/jpeg" : "video/mp4");
  checkBudget();
  return signedGet(key, LINK_SECONDS);
}

type Character = { image: { data: string; mime: string } | null; words: string; id?: string };

/** The character as image bytes, or their description when they were described in words. */
export async function characterOf(run: Run, who: string, dir: string): Promise<Character> {
  const face = run.hook.face;
  if (face?.kind === "character") {
    if (!/^[a-z0-9-]+$/.test(face.id)) throw new Error("Unknown character");
    const data = (await readFile(path.join(process.cwd(), "public", "characters", `${face.id}.jpg`))).toString("base64");
    return { image: { data, mime: "image/jpeg" }, words: "", id: face.id };
  }
  if (face?.kind === "photo") {
    const photo = await mediaToFile(face.mediaId, who, dir);
    if (!photo || !/^image\/(jpeg|png|webp)$/.test(photo.mime)) throw new Error("Your photo is missing. Upload it again.");
    return { image: { data: (await readFile(photo.file)).toString("base64"), mime: photo.mime }, words: "" };
  }
  if (face?.kind === "described" && face.text.trim()) return { image: null, words: face.text.trim().slice(0, 300) };
  throw new Error("Choose a character first.");
}

/** The hook's video: the library's cut hook clip, else the hook part of an uploaded video (cut into `dir`). */
export async function hookVideo(run: Run, source: Reference | null, who: string, dir: string): Promise<string | null> {
  if (!source) return null;
  const code = source.sourceUrl ? source.sourceUrl.replace(/\/+$/, "").split("/").pop() : "";
  if (code && /^[A-Za-z0-9_-]{5,40}$/.test(code)) {
    const clip = await libraryFile("hooks", code, dir);
    if (clip) return clip;
  }
  const info = source.mediaId ? await mediaToFile(source.mediaId, who, dir) : null;
  if (!info || !info.mime.startsWith("video/")) return null;
  const start = Math.max(0, run.hook.start ?? 0);
  const end = Math.max(start + 1, Math.min(start + 8, run.hook.end ?? start + 3));
  const out = path.join(dir, "hook-cut.mp4");
  // Even sizes: x264 refuses an odd width (Codex 2026-11-21: a 721 px wide upload failed here).
  await ff("-ss", start.toFixed(2), "-i", info.file, "-t", (end - start).toFixed(2), "-an", "-vf", "scale='max(2,trunc(iw/2)*2)':'max(2,trunc(ih/2)*2)'", "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p", out);
  return out;
}

/**
 * The character photo as JPEG bytes, always re-encoded from its first frame (a few ms): a PNG, a WebP or a broken file
 * that only claims to be a JPEG either becomes a real JPEG or fails here, before anything is paid for.
 */
async function asJpeg(image: { data: string; mime: string }, dir: string): Promise<Buffer> {
  const bytes = Buffer.from(image.data, "base64");
  const input = path.join(dir, "photo-in"), out = path.join(dir, "photo.jpg");
  await writeFile(input, bytes);
  await ff("-i", input, "-frames:v", "1", "-q:v", "2", out);
  return readFile(out);
}

/**
 * The clip Kling 4.0 edits: no sound, at most 30 s, at least 720 px on its short side (Kling refuses under 700 px).
 * A clip under 3 s is slowed to 3.2 s of real motion (short-hook.ts: Kling 4.0 refuses under 3 s); `factor` undoes it
 * on the result. One whose length cannot be read is held on its last frame up to MIN_REFERENCE seconds. `seconds` is
 * the length sent, so the result can be cut back to it.
 */
async function reference(clip: string, dir: string): Promise<{ bytes: Buffer; factor: number; seconds: number }> {
  const out = path.join(dir, "reference.mp4");
  const len = mp4Seconds(await readFile(clip)) ?? 0;
  const factor = slowFactor(len);
  // Under 1 s there is no motion to copy, and the slowdown would not fit the task id (short-hook.ts caps it at 10).
  if (len > 0 && len < MIN_CLIP) throw new Error("This hook is too short. Choose at least 1 second of it.");
  const filters = [factor > 1 ? `setpts=${factor}*PTS` : len < MIN_REFERENCE ? `tpad=stop_mode=clone:stop_duration=${MIN_REFERENCE}` : "", minSideFilter, "fps=30"].filter(Boolean);
  const cap = factor > 1 ? [] : ["-t", String(len > 0 && len < MIN_REFERENCE ? MIN_REFERENCE : 30)];
  await ff("-i", clip, "-an", "-vf", filters.join(","), ...cap, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", out);
  const bytes = await readFile(out);
  return { bytes, factor, seconds: mp4Seconds(bytes) ?? 0 };
}

/**
 * Start one hook generation; returns the provider task id. `note` is what went wrong last time (Regenerate).
 * `simple` is the job's single fallback attempt: the same request again (it no longer picks another model).
 * The durable generation job owns fallback and retry decisions.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the job API: the fallback is the same request.
export const startHook = (run: Run, source: Reference | null, who: string, note?: string, simple = false) => withWorkBudget(() => startHookInner(run, source, who, note));
async function startHookInner(run: Run, source: Reference | null, who: string, note?: string): Promise<string> {
  const fix = note?.trim() ? ` Fix this from the last try: ${note.trim().slice(0, 200)}.` : "";
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-hook-"));
  try {
    const character = await characterOf(run, who, dir);
    const clip = await hookVideo(run, source, who, dir);
    if (!clip && (source || run.hook.source === "library" || run.hook.source === "upload")) {
      throw new Error("The reference video is unavailable. Try again or choose another hook.");
    }

    if (clip) {
      // The face reference and the clip are prepared side by side; a library character's face is ready-made.
      const [face, sent] = await Promise.all([character.image ? faceRef(character.image, dir, character.id) : Promise.resolve(null), reference(clip, dir)]);
      const [videoUrl, faceUrl, photoUrl] = await Promise.all([
        share(sent.bytes, "mp4", who),
        face ? share(face, "jpg", who) : Promise.resolve(null),
        character.image ? share(await asJpeg(character.image, dir), "jpg", who) : Promise.resolve(null),
      ]);
      const input = faceUrl && photoUrl
        ? { prompt: `${SWAP_PROMPT}${fix}`, video_url: videoUrl, image_urls: [faceUrl, photoUrl] }
        : { prompt: `${swapPromptFor(character.words)}${fix}`, video_url: videoUrl };
      // The task id carries the slowdown and the length sent, so the result comes back at the original length.
      return withLength(withSlow(await falSubmit(SWAP, { ...input, resolution: "720p", keep_audio: false }), sent.factor), sent.seconds);
    }

    // A described hook: no original motion to follow.
    const doing = run.hook.describe?.trim() || "they look at their laptop screen, shocked, then cover their mouth and smile";
    const prompt = `${doing.slice(0, 600)}. ${LOOK}${fix}`;
    if (character.image) {
      const imageUrl = await share(await asJpeg(character.image, dir), "jpg", who);
      return falSubmit(IMAGE_TO_VIDEO, { start_image_url: imageUrl, prompt: `The person in the image, in the same place. ${prompt}`, duration: String(DESCRIBED_SECONDS), generate_audio: false, negative_prompt: NEGATIVE });
    }
    return falSubmit(TEXT_TO_VIDEO, { prompt: `Vertical 9:16 phone selfie of ${character.words}. ${prompt}`, duration: String(DESCRIBED_SECONDS), aspect_ratio: "9:16", generate_audio: false, negative_prompt: NEGATIVE });
  } finally {
    // Best effort: a cleanup error must never hide an accepted (paid) task id and trigger a second submission.
    await rm(dir, { recursive: true, force: true }).catch((error) => console.error("hook temp cleanup", error));
  }
}

/** `final`: the provider refused this input (safety); the identical retry would be refused too, so no fallback. */
export type HookTask = { state: "running"; progress: number } | { state: "done"; video: Buffer; seconds: number } | { state: "failed"; error: string; final?: boolean };

/** Length of an MP4 from its movie header (mvhd), without ffmpeg. */
export function mp4Seconds(buf: Buffer): number | null {
  // Walk box boundaries: compressed media can contain the bytes "mvhd" too.
  function find(start: number, end: number, movie = false): number {
    for (let pos = start; pos + 8 <= end;) {
      const size32 = buf.readUInt32BE(pos);
      const type = buf.toString("ascii", pos + 4, pos + 8);
      const header = size32 === 1 ? 16 : 8;
      if (pos + header > end) return -1;
      const size = size32 === 1 ? Number(buf.readBigUInt64BE(pos + 8)) : size32 || end - pos;
      if (!Number.isSafeInteger(size) || size < header || size > end - pos) return -1;
      if (type === "moov" && !movie) return find(pos + header, pos + size, true);
      if (type === "mvhd" && movie) {
        const at = pos + header - 4;
        return at + (buf[at + 4] === 1 ? 36 : 32) <= pos + size ? at : -1;
      }
      pos += size;
    }
    return -1;
  }
  const at = find(0, buf.length);
  if (at < 4 || at + 32 > buf.length) return null;
  const version = buf[at + 4];
  if (version > 1 || (version === 1 && at + 36 > buf.length)) return null;
  const scale = version === 1 ? buf.readUInt32BE(at + 24) : buf.readUInt32BE(at + 16);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(at + 28)) : buf.readUInt32BE(at + 20);
  const seconds = scale ? Math.round((duration / scale) * 100) / 100 : 0;
  return seconds > 0 && Number.isFinite(seconds) ? seconds : null;
}

/** Where a generation is; when it is done, the video itself (fal's link expires). */
export async function checkHook(taskId: string): Promise<HookTask> {
  const { model, id, factor, length } = parseTask(taskId);
  if (!model || !id || !/^[\w./-]+$/.test(model) || !/^[\w-]+$/.test(id)) return { state: "failed", error: "Unknown generation." };
  // fal's queue paths use the app (owner/name), not the full model path.
  const app = model.split("/").slice(0, 2).join("/");
  const status = await fetch(`${FAL}/${app}/requests/${id}/status`, { headers: falHeaders(), cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!status.ok) throw new Error(`fal status ${status.status}`);
  const s = (await status.json()) as { status?: string };
  if (s.status === "IN_QUEUE" || s.status === "IN_PROGRESS") return { state: "running", progress: s.status === "IN_PROGRESS" ? 0.5 : 0 };
  if (s.status !== "COMPLETED") throw new Error("Unknown provider status");
  const result = await fetch(`${FAL}/${app}/requests/${id}`, { headers: falHeaders(), cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!result.ok && ![400, 422].includes(result.status)) throw new Error(`fal result unavailable ${result.status}`);
  // An interrupted or malformed result response does not establish provider failure.
  // Leave the paid task recoverable instead of starting another paid attempt.
  // An explicit 400/422 is a provider failure even when its body is not JSON.
  // A failure's body is read as text first: a plain-text refusal must still be recognized as one (Codex 2026-11-21).
  const raw = result.ok ? "" : await result.text().catch(() => "");
  const body = (result.ok ? await result.json() : (() => { try { return JSON.parse(raw); } catch { return null; } })()) as { video?: { url?: string }; detail?: unknown } | null;
  if (result.ok && !body?.video?.url) throw new Error("Provider result is incomplete");
  // Explicit provider errors can trigger the job's single fallback.
  if (!result.ok) {
    console.error("fal result", taskId, result.status, JSON.stringify(body?.detail ?? body).slice(0, 300));
    const refused = /safety|nsfw|moderation|content[_ ]?policy|policy[_ ]?violation|prohibited/i.test(`${raw} ${JSON.stringify(body)}`);
    return refused ? { state: "failed", error: "The video model refused this one. Try another character or hook.", final: true } : { state: "failed", error: "The generation failed. Try again." };
  }
  const res = await fetch(body!.video!.url!, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error("Couldn't download the result");
  const generated = Buffer.from(await res.arrayBuffer());
  // Kling 4.0: its own audio off, cut to the length sent, a slowed short hook back to speed (short-hook.ts). Older
  // tasks (no length, no slowdown) come back untouched as before.
  const video = factor > 1 || length > 0 ? await finish(generated, factor, length) : generated;
  const seconds = mp4Seconds(video) ?? await probeSeconds(video);
  if (seconds === null) throw new Error("Generated video duration is unavailable");
  return { state: "done", video, seconds };
}

/** The generated clip without sound, cut to `length` seconds (0: as is) and sped up by `factor` (1: as is). */
async function finish(video: Buffer, factor: number, length: number): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-speed-"));
  try {
    const file = path.join(dir, "in.mp4"), out = path.join(dir, "out.mp4");
    await writeFile(file, video);
    await exec(await ffmpegPath(), ["-nostdin", "-v", "error", "-y", "-i", file, ...finishArgs(factor, length), "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { timeout: 60_000 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Length read by ffmpeg when the MP4 header could not be read directly (Codex V10: never guess a motion hook's length). */
async function probeSeconds(video: Buffer): Promise<number | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-probe-"));
  try {
    const file = path.join(dir, "result.mp4");
    await writeFile(file, video);
    // ffmpeg -i with no output exits non-zero; the duration is in its stderr either way.
    const stderr = await exec(await ffmpegPath(), ["-hide_banner", "-i", file], { timeout: 20_000 }).then((r) => r.stderr, (e: { stderr?: string }) => e.stderr ?? "");
    const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    const seconds = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
    if (seconds > 0) return Math.round(seconds * 100) / 100;
    console.error("hook duration unreadable; retaining the task for recovery");
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
