// Round 3 (founder: keep the original scene, camera and every movement; only the PERSON changes into the character).
// Tries Runway's video-to-video models that take the original video + a reference photo + a prompt:
//   G  Gemini Omni Flash 1.1, mode "edit"
//   H  Hailuo 3
// Usage: node --env-file=.env.local scripts/runway-replace.mjs <character>:<shortcode> [...]
// Writes .data/runway-test/<character>-<code>-{gemini,hailuo}.mp4 and a side-by-side <character>-<code>-replace.mp4.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import RunwayML from "@runwayml/sdk";

const ROOT = "/home/farhan/mavya-video";
const FF = `${ROOT}/node_modules/ffmpeg-static/ffmpeg`;
const OUT = `${ROOT}/.data/runway-test`;
const client = new RunwayML();
const dataUri = (path, mime) => `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const exists = (p) => { try { return statSync(p).size > 0; } catch { return false; } };
const save = async (url, dest) => writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()));
const PROMPT =
  "Replace the person in this video with the person in the reference image: their face, hair, skin tone and body. " +
  "Keep everything else exactly the same: the room, background, camera angle and movement, lighting, clothes, every gesture, expression and its timing. " +
  "Natural hands with five fingers. Remove all on-screen text, captions and stickers.";

console.log(`credits before: ${(await client.organization.retrieve()).creditBalance}`);
for (const pair of process.argv.slice(2)) {
  const [character, code] = pair.split(":");
  const hook = `${ROOT}/.data/hooks/${code}.mp4`;
  const photo = dataUri(`${ROOT}/public/characters/${character}.jpg`, "image/jpeg");
  const video = dataUri(hook, "video/mp4");
  console.log(`\n== ${character} on ${code}`);
  const jobs = [
    (async () => {
      const t0 = Date.now();
      const task = await client.videoToVideo
        // Edit mode keeps the input's orientation (720p); it takes no ratio.
        .create({ model: "gemini_omni_flash_1.1", mode: "edit", videoUri: video, references: [{ uri: photo }], promptText: PROMPT })
        .waitForTaskOutput({ timeout: 10 * 60 * 1000 });
      await save(task.output[0], `${OUT}/${character}-${code}-gemini.mp4`);
      console.log(`  G gemini done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    })(),
    (async () => {
      const t0 = Date.now();
      const task = await client.videoToVideo
        .create({ model: "hailuo3", promptVideo: video, references: [{ uri: photo }], promptText: PROMPT, ratio: "adaptive", resolution: "768p" })
        .waitForTaskOutput({ timeout: 10 * 60 * 1000 });
      await save(task.output[0], `${OUT}/${character}-${code}-hailuo.mp4`);
      console.log(`  H hailuo done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    })(),
  ];
  (await Promise.allSettled(jobs)).forEach((r, i) => r.status === "rejected" && console.log(`  ${"GH"[i]} failed: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`));

  const parts = [hook, `${OUT}/${character}-${code}-gemini.mp4`, `${OUT}/${character}-${code}-hailuo.mp4`].filter(exists);
  if (parts.length > 1) {
    const scale = parts.map((_, i) => `[${i}:v]scale=420:746:force_original_aspect_ratio=decrease,pad=420:746:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=3[v${i}]`).join(";");
    execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...parts.flatMap((p) => ["-i", p]), "-filter_complex", `${scale};${parts.map((_, i) => `[v${i}]`).join("")}hstack=${parts.length}[o]`, "-map", "[o]", "-t", "4", "-c:v", "libx264", "-crf", "20", `${OUT}/${character}-${code}-replace.mp4`]);
  }
}
console.log(`\ncredits after: ${(await client.organization.retrieve()).creditBalance}`);
