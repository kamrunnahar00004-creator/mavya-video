import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import RunwayML from "@runwayml/sdk";
import { geminiJSON } from "@/lib/server/gemini";
import { libraryFile, mediaToFile } from "@/lib/server/store";
import type { Reference, Run } from "@/lib/types";

/**
 * Hook generation (founder decisions 2026-10-21, after testing every Runway video model on real library hooks):
 *
 * A hook with a video (a library hook or an uploaded one): RECREATE it with the character.
 *   1. Gemini watches the hook and looks at the character: the motion second by second (head, eyes, mouth, each
 *      hand, objects, camera), the outfit for THIS person (same colors and style; anything that does not suit them,
 *      like a halter on a man, becomes the closest equivalent), and the moment the action has finished.
 *   2. Gemini 3.1 Flash Image puts the character, in that outfit, into the hook's first frame: same scene, objects,
 *      pose, expression and light, natural nails, nothing added, no captions.
 *   3. Veo 3.1 Fast animates from that frame with the motion and camera script, one continuous take, locked to the
 *      original's style (2026-10-23): same size of movements, same expression strength, same mouth (a calm or
 *      silent original stays calm or silent; talking is a negative prompt when the original does not speak).
 *   It works on every hook (Gemini Omni and Seedance refuse some) and keeps the original scene; the motion is very
 *   close, not frame-identical. About $0.52 and 80 s.
 * A described hook (no video): Veo 3.1 Fast from the character photo, the script's beats as the prompt ($0.40).
 * Never the original's captions: Mavya adds the product's own text on top.
 */
/** Generated hook length (Veo makes 4, 6 or 8 s; founder chose 6 s on 2026-10-21, $0.60 of Veo per hook). */
export const HOOK_SECONDS = 6;
let client: RunwayML | null = null;
const runway = () => (client ??= new RunwayML());
const exec = promisify(execFile);

/*
 * Veo's prompt is capped at 1000 characters (anything longer is cut off, which used to drop the rules at the end),
 * so every fixed piece below is short and the plan's parts have their own budgets (see veoPrompt).
 */
const NO_TEXT = "No text, captions or watermarks.";
/** Founder: the generated hooks had camera cuts; a hook is one take. */
const ONE_TAKE = "One continuous take: no cuts, jump cuts, angle or scene changes.";
const BODY = "Natural five-finger hands.";
/** Founder 2026-10-23: the character overacted (big mouth and face moves) where the original was calm. */
const NEGATIVE = "text, captions, subtitles, watermark, logo, cut, jump cut, scene change, transition, new objects, nail polish, extra fingers, deformed hands, distorted face, morphing, outfit change, exaggerated expressions, overacting, mugging, theatrical gestures";
const NEGATIVE_SILENT = `${NEGATIVE}, talking, speaking, lip movement, mouthing words`;

type Beat = { start: number; end: number; action: string };
type Recipe = { hook?: { camera?: string; mood?: string; setting?: string; beats?: Beat[] } };
const recipeOf = (r: Reference | null) => (r as (Reference & { recipe?: Recipe }) | null)?.recipe?.hook;

function ffmpegPath(): string {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const bin = require("ffmpeg-static") as string | null;
  if (!bin) throw new Error("ffmpeg unavailable");
  return bin;
}
const ff = (...args: string[]) => exec(ffmpegPath(), ["-nostdin", "-v", "error", "-y", ...args], { timeout: 60_000 });
const dataUri = async (file: string, mime: string) => `data:${mime};base64,${(await readFile(file)).toString("base64")}`;

/** The action, beat by beat: the script written for this product first, then the hook's recipe, then the user's own words. */
function action(run: Run, source: Reference | null): string {
  const script = run.script && run.script.refId === (source?.id ?? null) ? run.script.hookBeats : [];
  const beats = script.length ? script : (recipeOf(source)?.beats ?? []);
  if (beats.length) return beats.map((b) => `${b.start.toFixed(1)}-${b.end.toFixed(1)}s: ${b.action.replaceAll("{CHARACTER}", "the person")}`).join(" ");
  return run.hook.describe?.trim() || "they look at their laptop screen, shocked, then cover their mouth and smile";
}

/** The character as an image (data URI), or their description when they were described in words. */
async function characterOf(run: Run, who: string, dir: string): Promise<{ image: string | null; words: string }> {
  const face = run.hook.face;
  if (face?.kind === "character") {
    if (!/^[a-z0-9-]+$/.test(face.id)) throw new Error("Unknown character");
    return { image: await dataUri(path.join(process.cwd(), "public", "characters", `${face.id}.jpg`), "image/jpeg"), words: "" };
  }
  if (face?.kind === "photo") {
    const photo = await mediaToFile(face.mediaId, who, dir);
    if (!photo) throw new Error("Your photo is missing. Upload it again.");
    return { image: await dataUri(photo.file, photo.mime), words: "" };
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
  const out = path.join(dir, "hook.mp4");
  await ff("-ss", start.toFixed(2), "-i", info.file, "-t", (end - start).toFixed(2), "-an", "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", out);
  return out;
}

type Plan = { motion: Beat[]; energy: string; mouth: string; talking: boolean; camera: string; handheld: boolean; outfit: string };
const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    motion: { type: "ARRAY", items: { type: "OBJECT", properties: { start: { type: "NUMBER" }, end: { type: "NUMBER" }, action: { type: "STRING" } }, required: ["start", "end", "action"] } },
    energy: { type: "STRING" },
    mouth: { type: "STRING" },
    talking: { type: "BOOLEAN" },
    camera: { type: "STRING" },
    handheld: { type: "BOOLEAN" },
    outfit: { type: "STRING" },
  },
  required: ["motion", "energy", "mouth", "talking", "camera", "handheld", "outfit"],
};
/**
 * Founder 2026-10-23: the recreation must match the original's style exactly, hands to mouth: same size of movements,
 * same expression strength, same mouth (a calm original must not become a big, talky performance).
 */
const PLAN_PROMPT = (who: string) => `VIDEO 1 is a short selfie hook. ${who} will re-perform it EXACTLY, in ONE continuous ${HOOK_SECONDS}-second take with no cuts. Study VIDEO 1 frame by frame: the goal is the same performance, same style and same intensity, by a different person. Copy what is there; never add an action, gesture, expression or word that is not in VIDEO 1, and never make anything bigger or more dramatic than it is.
Write the plan in JSON:
- motion: the performance over 0 to ${HOOK_SECONDS} seconds, 4 to 7 segments in the same order as VIDEO 1, using VIDEO 1's REAL timestamps (do not stretch or slow it down). If VIDEO 1's first continuous shot ends before ${HOOK_SECONDS} s, the last segment runs to ${HOOK_SECONDS} s and HOLDS the final pose completely still (same hand position, same gaze, same expression): no new action, no lowering of hands, no turning away. If VIDEO 1 has a cut, keep only its first continuous shot. In each segment cover, only where something happens: head (tilt, turn, nod, how far), GAZE (at the lens, or away and to which side of the frame), eyebrows, mouth (closed, smiling, parted, or speaking), EACH hand: where it is in the frame (high, chest level, low; left or right; close to the lens or at the body), its shape (open palm, fist, pointing, relaxed fingers), its path, speed and what it touches. Name the gesture by what it does (e.g. "explaining gesture, hand moves low in front of the chest toward the lens"); never call it a wave unless VIDEO 1 shows a greeting wave. Concrete, physical, with the SIZE of each move ("small", "slight", "quick", "slow"), e.g. "right fist rises to cover the mouth, eyes look away to the right, slight head tilt". Every hand action MUST say where the hand is in the frame and its shape. Never describe who the person is. All segments together 300 to 420 characters: use the room for detail.
- energy: how big and intense the whole performance is in VIDEO 1, to match exactly: e.g. "calm and understated, small natural expressions" or "big surprised reaction, wide eyes, quick moves". Under 70 characters.
- mouth: exactly what the mouth does over time in VIDEO 1, with seconds: speaking (from when to when, normal pace, how wide the mouth opens), kept closed, a slight smile, or lips parted in surprise. Under 90 characters.
- talking: true if the lips move to form words at ANY moment of VIDEO 1 (watch the lips; most hooks open with the person saying something). False only if the mouth never forms words.
- camera: how the phone camera itself moves over the new ${HOOK_SECONDS} seconds, with seconds: handheld shake, drift, a quick push-in toward the face, pulling back, a zoom, a tilt or pan, or steady. Never a cut. Under 100 characters.
- handheld: true if VIDEO 1 is filmed on a phone held by hand (front or back camera) with any visible camera movement or shake.
- outfit: what the new person wears: the same garment colors and style as in VIDEO 1, unless that garment does not suit this person (for example a tank top, halter, crop top or dress on a man, or anything revealing), then the closest equivalent that suits them, same colors. No jewelry or nail polish unless the new person already has it. Under 120 characters.`;

/** The real-UGC look (founder 2026-10-21: Veo alone is too polished; no post-processing, it must be in the prompt). */
const UGC = "Handheld phone front camera, unstabilized micro-shake, casual real UGC, not cinematic.";

/** The style lock: same intensity and mouth as the original, nothing added or exaggerated. */
const performanceText = (plan: Plan) => `Same performance as the original: ${String(plan.energy ?? "").slice(0, 70)}. Mouth: ${String(plan.mouth ?? "").slice(0, 90)}. No overacting.`;

/** Gemini's plan for re-performing the hook: the motion, the camera and the outfit for this person. */
async function planFor(clip: string, who: { image: string | null; words: string }): Promise<Plan> {
  return geminiJSON<Plan>(
    [
      { text: "VIDEO 1:" },
      { inline_data: { mime_type: "video/mp4", data: (await readFile(clip)).toString("base64") } },
      ...(who.image ? [{ text: "IMAGE 2 (the new person):" }, { inline_data: { mime_type: who.image.slice(5, who.image.indexOf(";")), data: who.image.slice(who.image.indexOf(",") + 1) } }] : []),
      { text: PLAN_PROMPT(who.image ? "The person in IMAGE 2" : `A new person (${who.words})`) },
    ],
    { schema: PLAN_SCHEMA, temperature: 0.2 },
  );
}
const motionText = (plan: Plan) => (plan.motion ?? []).map((m) => `${m.start.toFixed(1)}-${m.end.toFixed(1)}s ${m.action}`).join(" ").slice(0, 440);
/** The camera part of the prompt: the original's camera moves, and the UGC look whenever it was handheld. */
const cameraText = (camera: string, handheld: boolean) => `Camera: ${camera.slice(0, 100)}.${handheld ? ` ${UGC}` : ""}`;

/**
 * Veo's prompt within its 1000 characters. The rules (one take, no text, hands) and the performance lock always fit;
 * only the motion is shortened when everything together would be too long.
 */
function veoPrompt(lead: string, motion: string, rest: string): string {
  const fixed = `${lead} ${rest} ${BODY} ${NO_TEXT}`;
  const room = Math.max(120, 1000 - fixed.length - 2);
  const m = motion.length > room ? `${motion.slice(0, room - 1).replace(/\s+\S*$/, "")}…` : motion;
  return `${lead} ${m} ${rest} ${BODY} ${NO_TEXT}`.replace(/\s+/g, " ").trim().slice(0, 1000);
}

/**
 * Start one hook generation; returns the Runway task id. `note` is what went wrong last time (Regenerate).
 * `simple`: skip the scene recreation and create from the character photo (the fallback when a model refuses).
 * If the recreation itself fails to start (a refusal in the plan or the frames), it falls back on its own.
 */
export async function startHook(run: Run, source: Reference | null, who: string, note?: string, simple = false): Promise<string> {
  if (!simple) {
    try {
      return await startHookInner(run, source, who, note, false);
    } catch (e) {
      if (e instanceof Error && /character|photo/i.test(e.message)) throw e;
      console.error("hook recreation failed, falling back to the photo", e);
    }
  }
  return startHookInner(run, source, who, note, true);
}

async function startHookInner(run: Run, source: Reference | null, user: string, note: string | undefined, simple: boolean): Promise<string> {
  const fix = note?.trim() ? ` Fix this from the last try: ${note.trim().slice(0, 200)}.` : "";
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-hook-"));
  try {
    const who = await characterOf(run, user, dir);
    const clip = await hookVideo(run, source, user, dir);
    // The plan comes from the original video when there is one; in the fallback a refused plan is not fatal.
    let plan: Plan | null = null;
    if (clip) {
      if (simple) plan = await planFor(clip, who).catch(() => null);
      else plan = await planFor(clip, who);
    }

    // A hook with a video: recreate it in its own scene.
    if (clip && plan && !simple) {
      const outfit = String(plan.outfit ?? "").slice(0, 160) || "the same clothes as in the scene";
      const first = path.join(dir, "first.jpg");
      await ff("-ss", "0.05", "-i", clip, "-frames:v", "1", "-q:v", "3", first);
      const person = who.image ? "@person" : `a person (${who.words})`;
      const swapPrompt = `Edit @scene: replace the person in it with ${person}${who.image ? " (their face, hair, skin tone and body)" : ""}, wearing ${outfit}. Keep everything else exactly as in @scene: every object they hold with the same shape, size and material, the same hand position, pose, head angle, gaze, the same facial expression at the same strength (mouth open or closed exactly as in @scene, no bigger smile or surprise), framing, camera angle, lighting, background and people behind them. Their hands have natural, unpolished nails and no rings. Remove all on-screen text and captions. Photorealistic phone selfie.`;
      // Gemini 3.1 Flash Image: of gen4_image, Gemini 3 Pro Image and GPT Image 2 it kept the scene, the held objects,
      // the expression and natural nails best (test 2026-10-21), and it is the fastest.
      const refs = [{ uri: await dataUri(first, "image/jpeg"), tag: "scene" }, ...(who.image ? [{ uri: who.image, tag: "person", subject: "human" as const }] : [])];
      const frame = await runway().textToImage.create({ model: "gemini_image3.1_flash", ratio: "768:1344", promptText: swapPrompt, referenceImages: refs }).waitForTaskOutput({ timeout: 3 * 60 * 1000 });
      const firstUrl = frame.output?.[0];
      if (!firstUrl) throw new Error("frame swap failed");
      // Only a first frame: a forced last frame made Veo dissolve into it when the motion ended elsewhere (not one take).
      const task = await runway().imageToVideo.create({
        model: "veo3.1_fast",
        promptImage: [{ uri: firstUrl, position: "first" }],
        promptText: veoPrompt(
          `Vertical phone selfie. ${ONE_TAKE} Same person, outfit, objects, room, light; natural nails.`,
          motionText(plan),
          `${performanceText(plan)} ${cameraText(plan.camera, plan.handheld)}${fix}`,
        ),
        negativePrompt: plan.talking ? NEGATIVE : NEGATIVE_SILENT,
        ratio: "720:1280",
        duration: HOOK_SECONDS,
        audio: false,
      });
      return task.id;
    }

    // From the character photo (the fallback, or a described hook): the plan's motion and camera when there is an
    // original video, else the script's beats; always the phone-filmed UGC look.
    const recipe = recipeOf(source);
    const doing = plan ? motionText(plan) : action(run, source);
    const camera = cameraText(plan?.camera ?? recipe?.camera ?? "front-facing selfie, close-up, held at arm's length", plan ? plan.handheld : true);
    const mood = recipe?.mood ? `Mood: ${recipe.mood}.` : "";
    if (who.image) {
      const task = await runway().imageToVideo.create({
        model: "veo3.1_fast",
        promptImage: [{ uri: who.image, position: "first" }],
        promptText: veoPrompt(`Vertical phone selfie video. ${ONE_TAKE} The person in the image, in the same place as in the image. ${mood}`, doing, `${plan ? performanceText(plan) : ""} ${camera}${fix}`),
        negativePrompt: plan && !plan.talking ? NEGATIVE_SILENT : NEGATIVE,
        ratio: "720:1280",
        duration: HOOK_SECONDS,
        audio: false,
      });
      return task.id;
    }
    const task = await runway().textToVideo.create({
      model: "veo3.1_fast",
      promptText: veoPrompt(`Vertical phone selfie video. ${ONE_TAKE} ${who.words}. ${mood}`, doing, `${plan ? performanceText(plan) : ""} ${camera}${fix}`),
      ratio: "720:1280",
      duration: HOOK_SECONDS,
      audio: false,
    });
    return task.id;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type HookTask = { state: "running"; progress: number } | { state: "done"; video: Buffer } | { state: "failed"; error: string };

/** Where a generation is; when it is done, the video itself (Runway's link expires within a day or two). */
export async function checkHook(taskId: string): Promise<HookTask> {
  const task = await runway().tasks.retrieve(taskId);
  if (task.status === "SUCCEEDED") {
    const url = task.output?.[0];
    if (!url) return { state: "failed", error: "The generation came back empty. Try again." };
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { state: "failed", error: "Couldn't download the result. Try again." };
    return { state: "done", video: Buffer.from(await res.arrayBuffer()) };
  }
  if (task.status === "FAILED" || task.status === "CANCELLED") {
    const why = "failure" in task && typeof task.failure === "string" ? task.failure : "";
    return { state: "failed", error: /moderation/i.test(why) ? "The video model refused this one. Try another character or hook." : "The generation failed. Try again." };
  }
  return { state: "running", progress: "progress" in task && typeof task.progress === "number" ? task.progress : 0 };
}
