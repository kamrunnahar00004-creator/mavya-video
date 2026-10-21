// Round 2 of the hook recreation test (Act-Two and Aleph 2 were too sloppy: hands, faces, props):
//   S  Seedance 2 Fast, video to video: the original hook is the motion source, the character photo the identity.
//   V  Veo 3.1 Fast, image to video: the character photo is the first frame, the recipe's beats are the prompt.
// Usage: node --env-file=.env.local scripts/runway-test2.mjs <character> <shortcode> [...]
// Writes .data/runway-test/<code>-{seed,veo}.mp4 and <code>-compare2.mp4 (original | Seedance | Veo).
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import RunwayML from "@runwayml/sdk";

const ROOT = "/home/farhan/mavya-video";
const FF = `${ROOT}/node_modules/ffmpeg-static/ffmpeg`;
const OUT = `${ROOT}/.data/runway-test`;
const [character, ...codes] = process.argv.slice(2);
const client = new RunwayML();
const dataUri = (path, mime) => `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const ff = (...args) => execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const probe = (path) => {
  try {
    execFileSync(FF, ["-hide_banner", "-i", path], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr));
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  }
  return 0;
};
const save = async (url, dest) => writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()));
const exists = (p) => { try { return statSync(p).size > 0; } catch { return false; } };
const db = JSON.parse(readFileSync(`${ROOT}/.data/db.json`, "utf8"));
const recipeOf = (code) => db.references.find((r) => (r.sourceUrl ?? "").includes(code))?.recipe;
const photo = dataUri(`${ROOT}/public/characters/${character}.jpg`, "image/jpeg");
const NO = "No text, captions, subtitles, stickers or watermarks anywhere in the frame.";
const HANDS = "Natural, anatomically correct hands with five fingers; no extra limbs; no props or accessories that are not in the reference photo (no glasses unless she wears them in the photo).";

console.log(`character ${character}, credits before: ${(await client.organization.retrieve()).creditBalance}`);
for (const code of codes) {
  const hook = `${ROOT}/.data/hooks/${code}.mp4`;
  const len = probe(hook);
  const rc = recipeOf(code);
  const beats = (rc?.hook?.beats ?? []).map((b) => `${b.start.toFixed(1)}-${b.end.toFixed(1)}s: ${b.action.replaceAll("{CHARACTER}", "she")}`).join(" ");
  console.log(`\n== ${code}: hook ${len.toFixed(2)}s`);

  const jobs = [
    // S: Seedance 2 Fast, the original hook drives the motion, the photo is who it is.
    (async () => {
      const t0 = Date.now();
      const task = await client.videoToVideo
        .create({
          model: "seedance2_fast",
          promptVideo: dataUri(hook, "video/mp4"),
          references: [{ uri: photo }],
          promptText: `Recreate this exact video with the woman from the reference image as the creator. Keep every movement, gesture, expression, head turn and its timing exactly as in the video, and keep the same camera, framing, room and lighting. Her face, hair and skin must match the reference image exactly, the whole time, and she wears the same outfit as the original creator. ${HANDS} ${NO} Realistic handheld phone footage.`,
          duration: Math.max(4, Math.ceil(len)),
          ratio: "720:1280",
          audio: false,
        })
        .waitForTaskOutput({ timeout: 10 * 60 * 1000 });
      await save(task.output[0], `${OUT}/${code}-seed.mp4`);
      console.log(`  S seedance done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    })(),
    // V: Veo 3.1 Fast, the photo is the first frame, the recipe's beats are the action.
    (async () => {
      const t0 = Date.now();
      const prompt = `Vertical selfie video filmed on a phone, ${rc?.hook?.camera ?? "handheld, front-facing close-up"}. The woman in the image, in her own room as in the image. Mood: ${rc?.hook?.mood ?? "surprised"}. Action: ${beats || "she reacts with shock to something on her screen"} Realistic, natural motion. ${HANDS} ${NO}`.slice(0, 1000);
      const task = await client.imageToVideo
        .create({
          model: "veo3.1_fast",
          promptImage: [{ uri: photo, position: "first" }],
          promptText: prompt,
          negativePrompt: "text, captions, subtitles, watermark, extra fingers, deformed hands, distorted face, glasses",
          ratio: "720:1280",
          duration: 4,
          audio: false,
        })
        .waitForTaskOutput({ timeout: 10 * 60 * 1000 });
      await save(task.output[0], `${OUT}/${code}-veo.mp4`);
      console.log(`  V veo done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    })(),
  ];
  const results = await Promise.allSettled(jobs);
  results.forEach((r, i) => r.status === "rejected" && console.log(`  ${"SV"[i]} failed: ${String(r.reason?.message ?? r.reason).slice(0, 400)}`));

  const parts = [hook, `${OUT}/${code}-seed.mp4`, `${OUT}/${code}-veo.mp4`].filter(exists);
  if (parts.length > 1) {
    const inputs = parts.flatMap((p) => ["-i", p]);
    const scale = parts.map((_, i) => `[${i}:v]scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=2[v${i}]`).join(";");
    ff(...inputs, "-filter_complex", `${scale};${parts.map((_, i) => `[v${i}]`).join("")}hstack=${parts.length}[out]`, "-map", "[out]", "-t", "4", "-c:v", "libx264", "-crf", "22", `${OUT}/${code}-compare2.mp4`);
  }
}
console.log(`\ncredits after: ${(await client.organization.retrieve()).creditBalance}`);
