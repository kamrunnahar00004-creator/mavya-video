// Which image model puts the character into a hook frame best (founder: same scene and objects, the character's own
// nails, an outfit that suits them)? Usage: node --env-file=.env.local scripts/runway-frames.mjs <character> <shortcode> "<outfit>"
// Writes .data/runway-test/frame-<model>-<character>-<code>.jpg
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import RunwayML from "@runwayml/sdk";

const ROOT = "/home/farhan/mavya-video";
const FF = `${ROOT}/node_modules/ffmpeg-static/ffmpeg`;
const client = new RunwayML();
const [character, code, outfit] = process.argv.slice(2);
const frame = `/tmp/frame-${code}.jpg`;
execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.05", "-i", `${ROOT}/.data/hooks/${code}.mp4`, "-frames:v", "1", "-q:v", "2", frame]);
const uri = (p) => `data:image/jpeg;base64,${readFileSync(p).toString("base64")}`;
const scene = uri(frame);
const person = uri(`${ROOT}/public/characters/${character}.jpg`);
const PROMPT = `Edit @scene: replace the person in it with @person (their face, hair, skin tone and body), wearing ${outfit}. Keep everything else exactly as in @scene: every object they hold with the same shape, size and material, the same hand position, pose, expression, framing, camera angle, lighting, background and people behind them. Their hands have natural, unpolished nails and no rings. Remove all on-screen text and captions. Photorealistic phone selfie.`;
const jobs = {
  gen4: { model: "gen4_image", ratio: "720:1280", promptText: PROMPT, referenceImages: [{ uri: scene, tag: "scene" }, { uri: person, tag: "person" }] },
  gemini3pro: { model: "gemini_image3_pro", ratio: "768:1344", promptText: PROMPT, referenceImages: [{ uri: scene, tag: "scene" }, { uri: person, tag: "person", subject: "human" }] },
  gemini31flash: { model: "gemini_image3.1_flash", ratio: "768:1344", promptText: PROMPT, referenceImages: [{ uri: scene, tag: "scene" }, { uri: person, tag: "person", subject: "human" }] },
  gptimage2: { model: "gpt_image_2", ratio: "1088:1920", quality: "medium", promptText: PROMPT, referenceImages: [{ uri: scene, tag: "scene" }, { uri: person, tag: "person" }] },
};
console.log(`credits before: ${(await client.organization.retrieve()).creditBalance}`);
await Promise.all(
  Object.entries(jobs).map(async ([name, body]) => {
    const t0 = Date.now();
    try {
      const task = await client.textToImage.create(body).waitForTaskOutput({ timeout: 5 * 60 * 1000 });
      writeFileSync(`${ROOT}/.data/runway-test/frame-${name}-${character}-${code}.jpg`, Buffer.from(await (await fetch(task.output[0])).arrayBuffer()));
      console.log(`${name}: ok in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      console.log(`${name}: failed ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }),
);
console.log(`credits after: ${(await client.organization.retrieve()).creditBalance}`);
