// Round 5: the Veo hybrid with strict instructions (founder: background, hand and face movement match the original;
// only the person changes; clothes keep their color and style, but must suit the new person, e.g. no tank top or
// halter on a man).
// 1. Gemini watches the original hook + looks at the character photo and writes: the exact motion (timed, head, eyes,
//    mouth, each hand, objects, camera), the outfit for THIS person, the scene, and the moment the action has finished.
// 2. gen4_image puts the character, in that outfit, into the original's first and end frames (scene kept, no text).
// 3. Veo 3.1 Fast animates from the first to the end frame with the motion script, no new objects.
// Usage: node --env-file=.env.local scripts/runway-hybrid2.mjs <character>:<shortcode> [...]
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import RunwayML from "@runwayml/sdk";

const ROOT = "/home/farhan/mavya-video";
const FF = `${ROOT}/node_modules/ffmpeg-static/ffmpeg`;
const OUT = `${ROOT}/.data/runway-test`;
const client = new RunwayML();
const ff = (...a) => execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...a]);
const b64 = (p) => readFileSync(p).toString("base64");
const dataUri = (p, mime) => `data:${mime};base64,${b64(p)}`;
const exists = (p) => { try { return statSync(p).size > 0; } catch { return false; } };
const save = async (url, dest) => writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()));
const wait = (p) => p.waitForTaskOutput({ timeout: 10 * 60 * 1000 });
const duration = (p) => {
  try { execFileSync(FF, ["-hide_banner", "-i", p], { stdio: ["ignore", "pipe", "pipe"] }); } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr));
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  }
  return 0;
};

const PLAN_PROMPT = `VIDEO 1 is a short selfie hook. IMAGE 2 is a different person who will re-perform it exactly.
Write the plan to recreate VIDEO 1 with the person from IMAGE 2. Answer in JSON.
- motion: the performance second by second, 4 to 7 segments covering the whole video. For each: what the head, eyes, mouth and EACH hand do, any object they hold, and camera movement. Concrete and physical ("right hand lifts the glass to the lips, eyes stay wide on the lens"). Never describe who the person is. All segments together under 550 characters.
- outfit: what the person from IMAGE 2 wears: the same garment colors and style as in VIDEO 1, unless that garment does not suit this person (for example a tank top, halter, crop top or dress on a man, or anything revealing), then the closest equivalent that suits them in the same colors. Under 120 characters.
- scene: the background, light and props of VIDEO 1, under 200 characters.
- endAt: the second when the last action has finished and the pose is settled (not mid-motion), within the video.`;
const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    motion: { type: "ARRAY", items: { type: "OBJECT", properties: { start: { type: "NUMBER" }, end: { type: "NUMBER" }, action: { type: "STRING" } }, required: ["start", "end", "action"] } },
    outfit: { type: "STRING" },
    scene: { type: "STRING" },
    endAt: { type: "NUMBER" },
  },
  required: ["motion", "outfit", "scene", "endAt"],
};

async function plan(hook, photo) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "VIDEO 1:" }, { inline_data: { mime_type: "video/mp4", data: b64(hook) } }, { text: "IMAGE 2:" }, { inline_data: { mime_type: "image/jpeg", data: b64(photo) } }, { text: PLAN_PROMPT }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: PLAN_SCHEMA, temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status} ${(await res.text()).slice(0, 200)}`);
  return JSON.parse((await res.json()).candidates[0].content.parts[0].text);
}

console.log(`credits before: ${(await client.organization.retrieve()).creditBalance}`);
for (const pair of process.argv.slice(2)) {
  const [character, code] = pair.split(":");
  const tag = `${character}-${code}`;
  const hook = `${ROOT}/.data/hooks/${code}.mp4`;
  const photoPath = `${ROOT}/public/characters/${character}.jpg`;
  const len = duration(hook);
  console.log(`\n== ${tag} (${len.toFixed(2)}s)`);
  const p = await plan(hook, photoPath);
  const endAt = Math.min(Math.max(p.endAt, 1), len - 0.05);
  const motion = p.motion.map((m) => `${m.start.toFixed(1)}-${m.end.toFixed(1)}s ${m.action}`).join(" ");
  console.log(`  outfit: ${p.outfit}\n  scene: ${p.scene}\n  end frame at ${endAt.toFixed(2)}s\n  motion: ${motion}`);
  writeFileSync(`${OUT}/${tag}-plan.json`, JSON.stringify(p, null, 1));

  ff("-ss", "0.05", "-i", hook, "-frames:v", "1", "-q:v", "3", `/tmp/${tag}-f0.jpg`);
  ff("-ss", endAt.toFixed(2), "-i", hook, "-frames:v", "1", "-q:v", "3", `/tmp/${tag}-f1.jpg`);
  const photo = dataUri(photoPath, "image/jpeg");
  const swapPrompt = `@scene with the person replaced by @person: @person's face, hair, skin tone and body, wearing ${p.outfit}. Exact same pose, hand positions, held objects, expression, framing, camera angle, lighting and background as @scene. Nothing added or removed. No text, captions or stickers.`;
  const swap = async (src, dest) => {
    const t = await wait(client.textToImage.create({ model: "gen4_image", ratio: "720:1280", promptText: swapPrompt, referenceImages: [{ uri: photo, tag: "person" }, { uri: dataUri(src, "image/jpeg"), tag: "scene" }] }));
    await save(t.output[0], dest);
  };
  await Promise.all([swap(`/tmp/${tag}-f0.jpg`, `${OUT}/${tag}-v2-first.jpg`), swap(`/tmp/${tag}-f1.jpg`, `${OUT}/${tag}-v2-last.jpg`)]);
  console.log("  frames swapped");

  const t = await wait(
    client.imageToVideo.create({
      model: "veo3.1_fast",
      promptImage: [{ uri: dataUri(`${OUT}/${tag}-v2-first.jpg`, "image/jpeg"), position: "first" }, { uri: dataUri(`${OUT}/${tag}-v2-last.jpg`, "image/jpeg"), position: "last" }],
      promptText: `Vertical handheld phone selfie video. Same person, outfit, room and light from the first to the last frame; no new objects. ${motion} Natural hands with five fingers. No text or captions.`.slice(0, 1000),
      negativePrompt: "text, captions, subtitles, watermark, new objects, mug, cup, extra fingers, deformed hands, distorted face, morphing, outfit change",
      ratio: "720:1280",
      duration: 4,
      audio: false,
    }),
  );
  await save(t.output[0], `${OUT}/${tag}-v2.mp4`);
  console.log("  veo done");
  const parts = [hook, `${OUT}/${tag}-v2.mp4`].filter(exists);
  const scale = parts.map((_, i) => `[${i}:v]scale=480:854:force_original_aspect_ratio=decrease,pad=480:854:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=3[v${i}]`).join(";");
  ff(...parts.flatMap((x) => ["-i", x]), "-filter_complex", `${scale};${parts.map((_, i) => `[v${i}]`).join("")}hstack=${parts.length}[o]`, "-map", "[o]", "-t", "4", "-c:v", "libx264", "-crf", "20", `${OUT}/${tag}-v2-compare.mp4`);
}
console.log(`\ncredits after: ${(await client.organization.retrieve()).creditBalance}`);
