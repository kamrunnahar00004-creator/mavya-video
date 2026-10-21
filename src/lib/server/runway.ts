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
 *   3. Veo 3.1 Fast animates from that frame with the motion and camera script, one continuous take.
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

const NO_TEXT = "No text, captions, subtitles, stickers or watermarks anywhere in the frame.";
/** Founder: the generated hooks had camera cuts; a hook is one take. */
const ONE_TAKE = "One continuous shot from the first to the last frame: no cuts, no jump cuts, no scene or angle changes, no transitions.";
const BODY = "Natural hands with five fingers, no extra limbs.";
const NEGATIVE = "text, captions, subtitles, watermark, logo, cut, jump cut, scene change, transition, new objects, nail polish, extra fingers, deformed hands, distorted face, morphing, outfit change";

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

type Plan = { motion: Beat[]; camera: string; handheld: boolean; outfit: string };
const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    motion: { type: "ARRAY", items: { type: "OBJECT", properties: { start: { type: "NUMBER" }, end: { type: "NUMBER" }, action: { type: "STRING" } }, required: ["start", "end", "action"] } },
    camera: { type: "STRING" },
    handheld: { type: "BOOLEAN" },
    outfit: { type: "STRING" },
  },
  required: ["motion", "camera", "handheld", "outfit"],
};
const PLAN_PROMPT = (who: string) => `VIDEO 1 is a short selfie hook. ${who} will re-perform it exactly, in ONE continuous ${HOOK_SECONDS}-second take with no cuts.
Write the plan in JSON:
- motion: the performance second by second over the new ${HOOK_SECONDS} seconds (0 to ${HOOK_SECONDS}), 4 to 7 segments: the same actions in the same order as VIDEO 1, spread at a natural, slightly slower pace so they fill the whole ${HOOK_SECONDS} seconds, ending on the settled final pose. If VIDEO 1 has a cut, keep only its first continuous shot's performance. For each: what the head, eyes, mouth and EACH hand do and any object they hold. Concrete and physical ("right hand lifts the glass to the lips, eyes stay wide on the lens"). Never describe who the person is. All segments together under 480 characters.
- camera: how the phone camera itself moves over the new ${HOOK_SECONDS} seconds, with seconds: handheld shake, drift, a quick push-in toward the face, pulling back, a zoom, a tilt or pan, or steady. Never a cut. Under 170 characters.
- handheld: true if VIDEO 1 is filmed on a phone held by hand (front or back camera) with any visible camera movement or shake.
- outfit: what the new person wears: the same garment colors and style as in VIDEO 1, unless that garment does not suit this person (for example a tank top, halter, crop top or dress on a man, or anything revealing), then the closest equivalent that suits them, same colors. No jewelry or nail polish unless the new person already has it. Under 120 characters.`;

/** The real-UGC look (founder 2026-10-21: Veo alone is too polished; no post-processing, it must be in the prompt). */
const UGC =
  "It must look like real UGC filmed by the person on their own phone front camera: handheld and NOT stabilized, natural micro-shake and small wobbles, slight autofocus and exposure shifts, casual framing. Not cinematic, no smooth gimbal or dolly moves, no studio lighting.";

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
const motionText = (plan: Plan) => (plan.motion ?? []).map((m) => `${m.start.toFixed(1)}-${m.end.toFixed(1)}s ${m.action}`).join(" ").slice(0, 520);
/** The camera part of the prompt: the original's camera moves, and the UGC look whenever it was handheld. */
const cameraText = (camera: string, handheld: boolean) => `Camera: ${camera.slice(0, 200)}.${handheld ? ` ${UGC}` : ""}`;

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
      const swapPrompt = `Edit @scene: replace the person in it with ${person}${who.image ? " (their face, hair, skin tone and body)" : ""}, wearing ${outfit}. Keep everything else exactly as in @scene: every object they hold with the same shape, size and material, the same hand position, pose, expression, framing, camera angle, lighting, background and people behind them. Their hands have natural, unpolished nails and no rings. Remove all on-screen text and captions. Photorealistic phone selfie.`;
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
        promptText: `Vertical phone selfie video. ${ONE_TAKE} Same person, outfit, held objects, room and light throughout; no new objects; natural unpolished nails. ${motionText(plan)} ${cameraText(plan.camera, plan.handheld)}${fix} ${BODY} ${NO_TEXT}`.slice(0, 1000),
        negativePrompt: NEGATIVE,
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
        promptText: `Vertical phone selfie video. ${ONE_TAKE} The person in the image, in the same place as in the image. ${mood} ${doing} ${camera}${fix} ${BODY} ${NO_TEXT}`.slice(0, 1000),
        negativePrompt: NEGATIVE,
        ratio: "720:1280",
        duration: HOOK_SECONDS,
        audio: false,
      });
      return task.id;
    }
    const task = await runway().textToVideo.create({
      model: "veo3.1_fast",
      promptText: `Vertical phone selfie video. ${ONE_TAKE} ${who.words}. ${mood} ${doing} ${camera}${fix} ${BODY} ${NO_TEXT}`.slice(0, 1000),
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
