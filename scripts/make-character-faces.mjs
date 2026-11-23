// Makes public/characters/faces/<id>.jpg for every library character: the face reference Kling 4.0 swaps with
// (src/lib/server/face-ref.ts, founder 2026-11-21). Same face box prompt and crop math as the app, done once ahead of
// time so a library character adds no time to a generation. Skips faces that exist unless --force.
// Usage: node --env-file=.env.local --experimental-strip-types scripts/make-character-faces.mjs [--force] [id ...]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { cropFilter, FALLBACK_REGION, headRegion } from "../src/lib/face-crop.ts";

const root = path.resolve(import.meta.dirname, "..");
const ffmpeg = path.join(root, "node_modules", "ffmpeg-static", "ffmpeg");
const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("--"));
const ids = [...readFileSync(path.join(root, "src/lib/characters.ts"), "utf8").matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1])
  .filter((id) => existsSync(path.join(root, "public/characters", `${id}.jpg`)))
  .filter((id) => !only.length || only.includes(id));
const out = path.join(root, "public/characters/faces");
mkdirSync(out, { recursive: true });

async function box(data) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: "image/jpeg", data } },
        { text: 'Find the face of the main person in this image. Answer in JSON: "box_2d" is [ymin, xmin, ymax, xmax] of the face (forehead to chin, ear to ear), each 0 to 1000.' },
      ] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { box_2d: { type: "ARRAY", items: { type: "NUMBER" } } }, required: ["box_2d"] } },
    }),
  });
  const body = await res.json();
  return JSON.parse(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}").box_2d;
}

let made = 0, fallback = 0;
for (const id of ids) {
  const file = path.join(out, `${id}.jpg`);
  if (existsSync(file) && !force) continue;
  const photo = path.join(root, "public/characters", `${id}.jpg`);
  let region = null;
  try { region = headRegion(await box(readFileSync(photo).toString("base64"))); } catch (e) { console.error(id, e.message); }
  if (!region) { region = FALLBACK_REGION; fallback++; console.error(`${id}: no face box, used the fallback region`); }
  execFileSync(ffmpeg, ["-nostdin", "-v", "error", "-y", "-i", photo, "-vf", cropFilter(region), "-frames:v", "1", "-q:v", "2", file]);
  made++;
}
console.log(`faces: ${made} made (${fallback} fallback), ${ids.length} characters`);
