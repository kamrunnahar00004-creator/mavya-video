import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import RunwayML from "@runwayml/sdk";
import { mediaInfo } from "@/lib/server/store";
import type { Reference, Run } from "@/lib/types";

/**
 * Hook generation with Runway: Veo 3.1 Fast (founder decision 2026-10-21, after Act-Two and Aleph 2 came out sloppy
 * and Seedance refused realistic faces). The character photo is the first frame; the action comes from the script
 * (or the hook's recipe, or the user's own description) as a written prompt. No audio (10 credits/s, 4 s = $0.40).
 * The original hook's captions are never asked for: Mavya adds the product's own text on top.
 */
export const HOOK_SECONDS = 4;
let client: RunwayML | null = null;
const runway = () => (client ??= new RunwayML());

const NO_TEXT = "No text, captions, subtitles, stickers or watermarks anywhere in the frame.";
const BODY = "Natural, anatomically correct hands with five fingers, no extra limbs, no props or accessories that are not in the photo.";
const NEGATIVE = "text, captions, subtitles, watermark, logo, extra fingers, deformed hands, distorted face, morphing";

type Beat = { start: number; end: number; action: string };
type Recipe = { hook?: { camera?: string; mood?: string; setting?: string; beats?: Beat[] } };

/** The action, beat by beat: the script written for this product first, then the hook's recipe, then the user's own words. */
function action(run: Run, source: Reference | null): string {
  const script = run.script && run.script.refId === (source?.id ?? null) ? run.script.hookBeats : [];
  const beats = script.length ? script : ((source as (Reference & { recipe?: Recipe }) | null)?.recipe?.hook?.beats ?? []);
  if (beats.length) return beats.map((b) => `${b.start.toFixed(1)}-${b.end.toFixed(1)}s: ${b.action.replaceAll("{CHARACTER}", "the person")}`).join(" ");
  return run.hook.describe?.trim() || "they look at their laptop screen, shocked, then cover their mouth and smile";
}

/** Start one hook generation; returns the Runway task id. `note` is what went wrong last time (Regenerate). */
export async function startHook(run: Run, source: Reference | null, note?: string): Promise<string> {
  const face = run.hook.face;
  const recipe = (source as (Reference & { recipe?: Recipe }) | null)?.recipe?.hook;
  const camera = recipe?.camera ?? "handheld front-facing selfie, close-up";
  const mood = recipe?.mood ? `Mood: ${recipe.mood}.` : "";
  const fix = note?.trim() ? ` Fix this from the last try: ${note.trim().slice(0, 200)}.` : "";

  let image: string | null = null;
  if (face?.kind === "character") {
    if (!/^[a-z0-9-]+$/.test(face.id)) throw new Error("Unknown character");
    image = `data:image/jpeg;base64,${(await readFile(path.join(process.cwd(), "public", "characters", `${face.id}.jpg`))).toString("base64")}`;
  } else if (face?.kind === "photo") {
    const info = await mediaInfo(face.mediaId);
    if (!info) throw new Error("Your photo is missing. Upload it again.");
    image = `data:${info.mime};base64,${(await readFile(info.file)).toString("base64")}`;
  } else if (face?.kind !== "described") {
    throw new Error("Choose a character first.");
  }

  if (image) {
    const prompt = `Vertical selfie video filmed on a phone, ${camera}. The person in the image, in the same place as in the image. ${mood} Action: ${action(run, source)} Realistic, natural motion.${fix} ${BODY} ${NO_TEXT}`;
    const task = await runway().imageToVideo.create({
      model: "veo3.1_fast",
      promptImage: [{ uri: image, position: "first" }],
      promptText: prompt.slice(0, 1000),
      negativePrompt: NEGATIVE,
      ratio: "720:1280",
      duration: HOOK_SECONDS,
      audio: false,
    });
    return task.id;
  }
  const who = face?.kind === "described" ? face.text.trim().slice(0, 300) : "";
  const prompt = `Vertical selfie video filmed on a phone, ${camera}. ${who}. ${mood} Action: ${action(run, source)} Realistic, natural motion.${fix} ${BODY} ${NO_TEXT}`;
  const task = await runway().textToVideo.create({ model: "veo3.1_fast", promptText: prompt.slice(0, 1000), ratio: "720:1280", duration: HOOK_SECONDS, audio: false });
  return task.id;
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
