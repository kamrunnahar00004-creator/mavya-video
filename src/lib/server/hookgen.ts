import "server-only";
import { checkBudget, withWorkBudget, workSignal } from "@/lib/server/work-budget";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { geminiJSON } from "@/lib/server/gemini";
import { putObject, signedGet } from "@/lib/server/r2";
import { libraryFile, mediaToFile } from "@/lib/server/store";
import type { Reference, Run } from "@/lib/types";

/**
 * Hook generation (founder decision 2026-10-23, after testing Veo, Wan Animate, H3 Recast and Kling side by side:
 * "100% kling stays", no Veo, no Runway).
 *
 * A hook with a video (a library hook or an uploaded one): RECREATE it with the character, with the original's
 * real motion.
 *   1. Gemini looks at the hook and the character and picks the outfit for THIS person (same colors and style;
 *      anything that does not suit them, like a halter on a man, becomes the closest equivalent).
 *   2. Gemini 3.1 Flash Image puts the character, in that outfit, into the hook's first frame: same scene, objects,
 *      pose, expression and light, natural nails, nothing added, no captions.
 *   3. Kling v3 Standard Motion Control (fal.ai) animates that frame with the ORIGINAL clip as the motion
 *      reference: same gestures, timing, gaze and mouth, one take, no captions (it draws from the clean frame).
 *      ~$0.126 per second of the clip, ~3.5 min. Runs as a background job (generation-jobs.ts).
 *   Fallback (the job's one automatic retry): the same with Kling v2.6 Standard Motion Control.
 * A described hook (no video): Kling v3 Standard image-to-video from the character photo, or text-to-video when the
 * character is described in words.
 * Never the original's captions: Mavya adds the product's own text on top. No post-processing of the result.
 */
const FAL = "https://queue.fal.run";
const MOTION = "fal-ai/kling-video/v3/standard/motion-control";
const MOTION_FALLBACK = "fal-ai/kling-video/v2.6/standard/motion-control";
const IMAGE_TO_VIDEO = "fal-ai/kling-video/v3/standard/image-to-video";
const TEXT_TO_VIDEO = "fal-ai/kling-video/v3/standard/text-to-video";
/** Length of a described hook (no original clip to follow). */
export const DESCRIBED_SECONDS = 5;
/** Kling needs a few seconds of reference motion; shorter library cuts hold their last frame to reach it. */
const MIN_REFERENCE = 3;
/** Provider links (frames, clips) are read by fal within minutes; give them a day for queues. */
const LINK_SECONDS = 24 * 3600;

const LOOK = "Real handheld phone selfie video, casual UGC, one continuous take. Natural five-finger hands. No text, captions, subtitles, stickers or watermarks anywhere on screen.";
/** Motion control: the reference clip is the performance to copy (founder 2026-10-23: as close to the original as possible). */
const MATCH =
  "Copy the reference video's performance exactly and as closely as possible: the same gestures, hand positions and hand shapes, head moves, gaze direction, facial expressions at the same strength, mouth movements and timing, frame by frame. Add nothing, exaggerate nothing, no extra gestures, no overacting. Keep the same person, face, hair, outfit, held objects, room, framing and light as in the image for the whole video; no new objects.";
const NEGATIVE = "text, captions, subtitles, watermark, logo, cut, scene change, extra fingers, deformed hands, distorted face, morphing, exaggerated expressions, overacting";

const exec = promisify(execFile);
function ffmpegPath(): string {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const bin = require("ffmpeg-static") as string | null;
  if (!bin) throw new Error("ffmpeg unavailable");
  return bin;
}
const ff = (...args: string[]) => exec(ffmpegPath(), ["-nostdin", "-v", "error", "-y", ...args], { timeout: 60_000, signal: workSignal(60_000) });

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

type Character = { image: { data: string; mime: string } | null; words: string };

/** The character as image bytes, or their description when they were described in words. */
async function characterOf(run: Run, who: string, dir: string): Promise<Character> {
  const face = run.hook.face;
  if (face?.kind === "character") {
    if (!/^[a-z0-9-]+$/.test(face.id)) throw new Error("Unknown character");
    const data = (await readFile(path.join(process.cwd(), "public", "characters", `${face.id}.jpg`))).toString("base64");
    return { image: { data, mime: "image/jpeg" }, words: "" };
  }
  if (face?.kind === "photo") {
    const photo = await mediaToFile(face.mediaId, who, dir);
    if (!photo) throw new Error("Your photo is missing. Upload it again.");
    return { image: { data: (await readFile(photo.file)).toString("base64"), mime: photo.mime }, words: "" };
  }
  if (face?.kind === "described" && face.text.trim()) return { image: null, words: face.text.trim().slice(0, 300) };
  throw new Error("Choose a character first.");
}

/** The hook's video: the library's cut hook clip, else the hook part of an uploaded video (cut into `dir`). */
async function hookVideo(run: Run, source: Reference | null, who: string, dir: string): Promise<string | null> {
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
  await ff("-ss", start.toFixed(2), "-i", info.file, "-t", (end - start).toFixed(2), "-an", "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", out);
  return out;
}

/** The motion reference: the clip without sound, held on its last frame up to MIN_REFERENCE seconds. */
async function motionReference(clip: string, dir: string): Promise<Buffer> {
  const out = path.join(dir, "reference.mp4");
  const len = mp4Seconds(await readFile(clip)) ?? 0;
  const hold = len < MIN_REFERENCE ? ["-vf", `tpad=stop_mode=clone:stop_duration=${MIN_REFERENCE}`, "-t", String(MIN_REFERENCE)] : ["-t", "30"];
  await ff("-i", clip, "-an", ...hold, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", out);
  return readFile(out);
}

const OUTFIT_SCHEMA = { type: "OBJECT", properties: { outfit: { type: "STRING" } }, required: ["outfit"] };
/** What the new person wears: same colors and style as the original, unless it does not suit them. */
async function outfitFor(clip: string, who: Character): Promise<string> {
  const plan = await geminiJSON<{ outfit: string }>(
    [
      { text: "VIDEO 1:" },
      { inline_data: { mime_type: "video/mp4", data: (await readFile(clip)).toString("base64") } },
      ...(who.image ? [{ text: "IMAGE 2 (the new person):" }, { inline_data: { mime_type: who.image.mime, data: who.image.data } }] : []),
      {
        text: `${who.image ? "The person in IMAGE 2" : `A new person (${who.words})`} will take the place of the person in VIDEO 1. Write in JSON what the new person wears ("outfit"): the same garment colors and style as in VIDEO 1, unless that garment does not suit this person (for example a tank top, halter, crop top or dress on a man, or anything revealing), then the closest equivalent that suits them, same colors. No jewelry or nail polish unless the new person already has it. Under 120 characters.`,
      },
    ],
    { schema: OUTFIT_SCHEMA, temperature: 0.2, signal: workSignal(120_000) },
  );
  return String(plan.outfit ?? "").slice(0, 160) || "the same clothes as in the scene";
}

/** Gemini 3.1 Flash Image: the character, in the outfit, put into the hook's first frame. */
async function swapFirstFrame(firstFrame: Buffer, who: Character, outfit: string): Promise<Buffer> {
  const person = who.image ? "the person in IMAGE 2 (their face, hair, skin tone and body)" : `a person (${who.words})`;
  const prompt = `Edit IMAGE 1: replace the person in it with ${person}, wearing ${outfit}. Keep everything else exactly as in IMAGE 1: every object they hold with the same shape, size and material, the same hand position, pose, head angle, gaze, the same facial expression at the same strength (mouth open or closed exactly as in IMAGE 1, no bigger smile or surprise), framing, camera angle, lighting, background and people behind them. Their hands have natural, unpolished nails and no rings. Remove all on-screen text and captions. Photorealistic phone selfie.`;
  const parts = [
    { text: "IMAGE 1 (the scene):" },
    { inline_data: { mime_type: "image/jpeg", data: firstFrame.toString("base64") } },
    ...(who.image ? [{ text: "IMAGE 2 (the new person):" }, { inline_data: { mime_type: who.image.mime, data: who.image.data } }] : []),
    { text: prompt },
  ];
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } } }),
    signal: workSignal(180_000),
  });
  const out = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { inlineData?: { data?: string }; inline_data?: { data?: string } }[] } }[] } | null;
  const data = out?.candidates?.[0]?.content?.parts?.map((p) => p.inlineData?.data ?? p.inline_data?.data).find(Boolean);
  if (!res.ok || !data) throw new Error(`frame swap failed (${res.status})`);
  return Buffer.from(data, "base64");
}

/**
 * Start one hook generation; returns the provider task id. `note` is what went wrong last time (Regenerate).
 * `simple` is the job's single fallback attempt (Kling v2.6 motion control, or the same text/image path).
 * The durable generation job owns fallback and retry decisions.
 */
export const startHook = (run: Run, source: Reference | null, who: string, note?: string, simple = false) => withWorkBudget(() => startHookInner(run, source, who, note, simple));
async function startHookInner(run: Run, source: Reference | null, who: string, note?: string, simple = false): Promise<string> {
  const fix = note?.trim() ? ` Fix this from the last try: ${note.trim().slice(0, 200)}.` : "";
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-hook-"));
  try {
    const character = await characterOf(run, who, dir);
    const clip = await hookVideo(run, source, who, dir);

    if (clip) {
      const [outfit, reference] = await Promise.all([outfitFor(clip, character), motionReference(clip, dir)]);
      const first = path.join(dir, "first.jpg");
      await ff("-ss", "0.05", "-i", clip, "-frames:v", "1", "-q:v", "2", first);
      const frame = await swapFirstFrame(await readFile(first), character, outfit);
      const [imageUrl, videoUrl] = await Promise.all([share(frame, "jpg", who), share(reference, "mp4", who)]);
      return falSubmit(simple ? MOTION_FALLBACK : MOTION, {
        image_url: imageUrl,
        video_url: videoUrl,
        character_orientation: "video",
        keep_original_sound: false,
        prompt: `${MATCH} ${LOOK}${fix}`,
      });
    }

    // A described hook: no original motion to follow.
    const doing = run.hook.describe?.trim() || "they look at their laptop screen, shocked, then cover their mouth and smile";
    const prompt = `${doing.slice(0, 600)}. ${LOOK}${fix}`;
    if (character.image) {
      const imageUrl = await share(Buffer.from(character.image.data, "base64"), "jpg", who);
      return falSubmit(IMAGE_TO_VIDEO, { start_image_url: imageUrl, prompt: `The person in the image, in the same place. ${prompt}`, duration: String(DESCRIBED_SECONDS), generate_audio: false, negative_prompt: NEGATIVE });
    }
    return falSubmit(TEXT_TO_VIDEO, { prompt: `Vertical 9:16 phone selfie of ${character.words}. ${prompt}`, duration: String(DESCRIBED_SECONDS), aspect_ratio: "9:16", generate_audio: false, negative_prompt: NEGATIVE });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type HookTask = { state: "running"; progress: number } | { state: "done"; video: Buffer; seconds: number } | { state: "failed"; error: string };

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
  return scale ? Math.round((duration / scale) * 100) / 100 : null;
}

/** Where a generation is; when it is done, the video itself (fal's link expires). */
export async function checkHook(taskId: string): Promise<HookTask> {
  const [model, id] = taskId.split("|");
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
  const body = (result.ok ? await result.json() : await result.json().catch(() => null)) as { video?: { url?: string }; detail?: unknown } | null;
  if (result.ok && !body?.video?.url) throw new Error("Provider result is incomplete");
  // Explicit provider errors can trigger the job's single fallback.
  if (!result.ok) {
    console.error("fal result", taskId, result.status, JSON.stringify(body?.detail ?? body).slice(0, 300));
    return { state: "failed", error: /safety|nsfw|moderation/i.test(JSON.stringify(body)) ? "The video model refused this one. Try another character or hook." : "The generation failed. Try again." };
  }
  const res = await fetch(body!.video!.url!, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error("Couldn't download the result");
  const video = Buffer.from(await res.arrayBuffer());
  return { state: "done", video, seconds: mp4Seconds(video) ?? (await probeSeconds(video)) ?? DESCRIBED_SECONDS };
}

/** Length read by ffmpeg when the MP4 header could not be read directly (Codex V10: never guess a motion hook's length). */
async function probeSeconds(video: Buffer): Promise<number | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-probe-"));
  try {
    const file = path.join(dir, "result.mp4");
    await writeFile(file, video);
    // ffmpeg -i with no output exits non-zero; the duration is in its stderr either way.
    const stderr = await exec(ffmpegPath(), ["-hide_banner", "-i", file], { timeout: 20_000 }).then((r) => r.stderr, (e: { stderr?: string }) => e.stderr ?? "");
    const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    const seconds = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
    if (seconds > 0) return Math.round(seconds * 100) / 100;
    console.error("hook duration unreadable; using the default length");
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
