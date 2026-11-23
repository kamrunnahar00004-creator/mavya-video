import "server-only";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ffmpegPath } from "@/lib/server/ffmpeg";
import { geminiJSON } from "@/lib/server/gemini";
import { workSignal } from "@/lib/server/work-budget";
import { cropFilter, FALLBACK_REGION, headRegion, type Region } from "@/lib/face-crop";

/**
 * The character's face as a reference image for Kling 4.0 (face-crop.ts says why).
 * A library character's face is made ahead of time (public/characters/faces/<id>.jpg, scripts/make-character-faces.mjs),
 * so a library character costs no extra time. An uploaded photo is cut here: Gemini finds the face (a few seconds),
 * and when it cannot, the upper middle of the photo is used. Never fails a generation over the crop: the whole photo
 * still goes along as the second reference.
 */

const exec = promisify(execFile);
const BOX_SCHEMA = { type: "OBJECT", properties: { box_2d: { type: "ARRAY", items: { type: "NUMBER" } } }, required: ["box_2d"] };

/** Where the main person's face is, as a region (fallback when Gemini cannot say). */
export async function faceRegion(image: { data: string; mime: string }): Promise<Region> {
  try {
    const found = await geminiJSON<{ box_2d?: unknown }>(
      [
        { inline_data: { mime_type: image.mime, data: image.data } },
        { text: 'Find the face of the main person in this image. Answer in JSON: "box_2d" is [ymin, xmin, ymax, xmax] of the face (forehead to chin, ear to ear), each 0 to 1000.' },
      ],
      { schema: BOX_SCHEMA, temperature: 0, signal: workSignal(30_000) },
    );
    return headRegion(found.box_2d) ?? FALLBACK_REGION;
  } catch (error) {
    console.error("face box", error);
    return FALLBACK_REGION;
  }
}

/** Cut `region` out of the image with ffmpeg; returns JPEG bytes. */
export async function cutFace(image: { data: string; mime: string }, region: Region, dir: string): Promise<Buffer> {
  const input = path.join(dir, "character-in"), out = path.join(dir, "character-face.jpg");
  await writeFile(input, Buffer.from(image.data, "base64"));
  await exec(await ffmpegPath(), ["-nostdin", "-v", "error", "-y", "-i", input, "-vf", cropFilter(region), "-frames:v", "1", "-q:v", "2", out], { timeout: 30_000, signal: workSignal(30_000) });
  return readFile(out);
}

/** The face reference: the prepared one for a library character, else cut from the photo. */
export async function faceRef(image: { data: string; mime: string }, dir: string, characterId?: string): Promise<Buffer> {
  if (characterId && /^[a-z0-9-]+$/.test(characterId)) {
    const ready = await readFile(path.join(process.cwd(), "public", "characters", "faces", `${characterId}.jpg`)).catch(() => null);
    if (ready?.length) return ready;
  }
  return cutFace(image, await faceRegion(image), dir);
}
