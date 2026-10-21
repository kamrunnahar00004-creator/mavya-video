// Compare the two ways to recreate a library hook with an AI character (founder decision input, 2026-10-21):
//   A  Act-Two: the character photo performs the hook's moves (background comes from the photo).
//   B  Aleph 2: a guide frame (character put into the hook's first frame by gen4_image, captions removed),
//      then Aleph 2 edits the original hook clip to match it (keeps the original room).
// Usage: node --env-file=.env.local scripts/runway-test.mjs <character> <shortcode> [...]
// Writes .data/runway-test/<code>-{act2,frame,aleph}.*  and a side-by-side <code>-compare.mp4.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import RunwayML from "@runwayml/sdk";

const ROOT = "/home/farhan/mavya-video";
const FF = `${ROOT}/node_modules/ffmpeg-static/ffmpeg`;
const OUT = `${ROOT}/.data/runway-test`;
mkdirSync(OUT, { recursive: true });
const [character, ...codes] = process.argv.slice(2);
const client = new RunwayML();
const dataUri = (path, mime) => `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const ff = (...args) => execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const duration = (path) => Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(execFileSync(FF, ["-hide_banner", "-i", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).toString() || "")?.slice(1).reduce((s, v, i) => s + Number(v) * [3600, 60, 1][i], 0));
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
const credits = async () => (await client.organization.retrieve()).creditBalance;

const photo = dataUri(`${ROOT}/public/characters/${character}.jpg`, "image/jpeg");
console.log(`character ${character}, credits before: ${await credits()}`);

for (const code of codes) {
  const hook = `${ROOT}/.data/hooks/${code}.mp4`;
  const len = probe(hook);
  console.log(`\n== ${code}: hook ${len.toFixed(2)}s`);

  // Act-Two needs 3 to 30 s of driving video: hold the last frame if the hook is shorter.
  const driving = `${OUT}/${code}-driving.mp4`;
  if (len < 3.05) ff("-i", hook, "-vf", `tpad=stop_mode=clone:stop_duration=${(3.1 - len).toFixed(2)}`, "-an", "-c:v", "libx264", "-crf", "20", driving);
  else ff("-i", hook, "-an", "-c:v", "libx264", "-crf", "20", driving);

  const jobs = [];
  // A: Act-Two
  jobs.push((async () => {
    const t0 = Date.now();
    const task = await client.characterPerformance
      .create({ model: "act_two", character: { type: "image", uri: photo }, reference: { type: "video", uri: dataUri(driving, "video/mp4") }, ratio: "720:1280", bodyControl: true, expressionIntensity: 3 })
      .waitForTaskOutput({ timeout: 10 * 60 * 1000 });
    const raw = `${OUT}/${code}-act2-raw.mp4`;
    await save(task.output[0], raw);
    ff("-i", raw, "-t", len.toFixed(2), "-c:v", "libx264", "-crf", "20", `${OUT}/${code}-act2.mp4`);
    console.log(`  A act-two done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  })());
  // B: guide frame, then Aleph 2
  jobs.push((async () => {
    const t0 = Date.now();
    const first = `${OUT}/${code}-first.jpg`;
    ff("-ss", "0.1", "-i", hook, "-frames:v", "1", "-q:v", "3", first);
    const img = await client.textToImage
      .create({
        model: "gen4_image",
        ratio: "720:1280",
        promptText: "@scene with @person in it: the exact same pose, framing, camera angle, lighting and room as @scene, but the person is @person. No text, captions or overlays.",
        referenceImages: [{ uri: photo, tag: "person" }, { uri: dataUri(first, "image/jpeg"), tag: "scene" }],
      })
      .waitForTaskOutput({ timeout: 10 * 60 * 1000 });
    const frame = `${OUT}/${code}-frame.jpg`;
    await save(img.output[0], frame);
    const vid = await client.videoToVideo
      .create({
        model: "aleph2",
        videoUri: dataUri(hook, "video/mp4"),
        keyframes: [{ seconds: 0, uri: dataUri(frame, "image/jpeg") }],
        promptText: "Replace the person with the person in the keyframe. Same moves, expressions, room, camera and lighting. Remove all on-screen text and captions.",
      })
      .waitForTaskOutput({ timeout: 10 * 60 * 1000 });
    await save(vid.output[0], `${OUT}/${code}-aleph.mp4`);
    console.log(`  B aleph 2 done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  })());
  const results = await Promise.allSettled(jobs);
  results.forEach((r, i) => r.status === "rejected" && console.log(`  ${"AB"[i]} failed: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`));

  // Side by side: original | Act-Two | Aleph 2 (whatever exists), 360 px wide each.
  const parts = [hook, `${OUT}/${code}-act2.mp4`, `${OUT}/${code}-aleph.mp4`].filter((p) => { try { return statSync(p).size > 0; } catch { return false; } });
  if (parts.length > 1) {
    const inputs = parts.flatMap((p) => ["-i", p]);
    const scale = parts.map((_, i) => `[${i}:v]scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`).join(";");
    ff(...inputs, "-filter_complex", `${scale};${parts.map((_, i) => `[v${i}]`).join("")}hstack=${parts.length}[out]`, "-map", "[out]", "-t", len.toFixed(2), "-c:v", "libx264", "-crf", "22", `${OUT}/${code}-compare.mp4`);
  }
}
console.log(`\ncredits after: ${await credits()}`);
