// Round 4: must work 100% of the time, keep the original scene, only the person changes.
// 1. gen4_image puts the character into the hook's FIRST and LAST frames (same pose, clothes, room, light; no captions).
// 2a. Act-Two: the swapped first frame is the character, the original hook drives the motion (the output keeps the
//     frame's scene, i.e. the original room).
// 2b. Veo 3.1 Fast: starts on the swapped first frame, ends on the swapped last frame, the recipe beats in between.
// Usage: node --env-file=.env.local scripts/runway-hybrid.mjs <character>:<shortcode> [...]
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import RunwayML from "@runwayml/sdk";

const ROOT = "/home/farhan/mavya-video";
const FF = `${ROOT}/node_modules/ffmpeg-static/ffmpeg`;
const OUT = `${ROOT}/.data/runway-test`;
const client = new RunwayML();
const db = JSON.parse(readFileSync(`${ROOT}/.data/db.json`, "utf8"));
const ff = (...a) => execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...a]);
const dataUri = (p, mime) => `data:${mime};base64,${readFileSync(p).toString("base64")}`;
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
const SWAP = "@scene with the person replaced by @person: @person's face, hair, skin tone and body, in the exact same pose, hand position, expression, clothes, framing, camera angle, lighting and room as @scene. Remove all text, captions and stickers.";

console.log(`credits before: ${(await client.organization.retrieve()).creditBalance}`);
for (const pair of process.argv.slice(2)) {
  const [character, code] = pair.split(":");
  const tag = `${character}-${code}`;
  const hook = `${ROOT}/.data/hooks/${code}.mp4`;
  const len = duration(hook);
  const photo = dataUri(`${ROOT}/public/characters/${character}.jpg`, "image/jpeg");
  console.log(`\n== ${tag} (${len.toFixed(2)}s)`);

  // 1. Swapped first and last frames.
  ff("-ss", "0.05", "-i", hook, "-frames:v", "1", "-q:v", "3", `/tmp/${tag}-f0.jpg`);
  ff("-sseof", "-0.1", "-i", hook, "-frames:v", "1", "-q:v", "3", `/tmp/${tag}-f1.jpg`);
  const swap = async (src, dest) => {
    const t = await wait(client.textToImage.create({ model: "gen4_image", ratio: "720:1280", promptText: SWAP, referenceImages: [{ uri: photo, tag: "person" }, { uri: dataUri(src, "image/jpeg"), tag: "scene" }] }));
    await save(t.output[0], dest);
  };
  try {
    await Promise.all([swap(`/tmp/${tag}-f0.jpg`, `${OUT}/${tag}-first.jpg`), swap(`/tmp/${tag}-f1.jpg`, `${OUT}/${tag}-last.jpg`)]);
    console.log("  frames swapped");
  } catch (e) {
    console.log("  frame swap failed:", String(e?.message ?? e).slice(0, 300));
    continue;
  }
  const first = dataUri(`${OUT}/${tag}-first.jpg`, "image/jpeg");
  const last = dataUri(`${OUT}/${tag}-last.jpg`, "image/jpeg");

  // Act-Two needs 3 to 30 s of driving video.
  const driving = `/tmp/${tag}-driving.mp4`;
  if (len < 3.05) ff("-i", hook, "-vf", `tpad=stop_mode=clone:stop_duration=${(3.1 - len).toFixed(2)}`, "-an", "-c:v", "libx264", "-crf", "20", driving);
  else ff("-i", hook, "-an", "-c:v", "libx264", "-crf", "20", driving);
  const beats = (db.references.find((r) => (r.sourceUrl ?? "").includes(code))?.recipe?.hook?.beats ?? []).map((b) => `${b.start.toFixed(1)}-${b.end.toFixed(1)}s: ${b.action.replaceAll("{CHARACTER}", "the person")}`).join(" ");

  const jobs = [
    (async () => {
      const t = await wait(client.characterPerformance.create({ model: "act_two", character: { type: "image", uri: first }, reference: { type: "video", uri: dataUri(driving, "video/mp4") }, ratio: "720:1280", bodyControl: true, expressionIntensity: 2 }));
      await save(t.output[0], `/tmp/${tag}-act2.mp4`);
      ff("-i", `/tmp/${tag}-act2.mp4`, "-t", len.toFixed(2), "-c:v", "libx264", "-crf", "20", `${OUT}/${tag}-hyb-act2.mp4`);
      console.log("  A act-two done");
    })(),
    (async () => {
      const t = await wait(
        client.imageToVideo.create({
          model: "veo3.1_fast",
          promptImage: [{ uri: first, position: "first" }, { uri: last, position: "last" }],
          promptText: `Vertical handheld phone video. The same person, room, clothes and camera throughout. Action: ${beats} Realistic, natural motion; natural hands with five fingers. No text, captions or watermarks.`.slice(0, 1000),
          negativePrompt: "text, captions, subtitles, watermark, extra fingers, deformed hands, distorted face, morphing",
          ratio: "720:1280",
          duration: 4,
          audio: false,
        }),
      );
      await save(t.output[0], `${OUT}/${tag}-hyb-veo.mp4`);
      console.log("  B veo first+last done");
    })(),
  ];
  (await Promise.allSettled(jobs)).forEach((r, i) => r.status === "rejected" && console.log(`  ${"AB"[i]} failed: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`));

  const parts = [hook, `${OUT}/${tag}-hyb-act2.mp4`, `${OUT}/${tag}-hyb-veo.mp4`].filter(exists);
  if (parts.length > 1) {
    const scale = parts.map((_, i) => `[${i}:v]scale=420:746:force_original_aspect_ratio=decrease,pad=420:746:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=3[v${i}]`).join(";");
    ff(...parts.flatMap((p) => ["-i", p]), "-filter_complex", `${scale};${parts.map((_, i) => `[v${i}]`).join("")}hstack=${parts.length}[o]`, "-map", "[o]", "-t", "4", "-c:v", "libx264", "-crf", "20", `${OUT}/${tag}-hybrid.mp4`);
  }
}
console.log(`\ncredits after: ${(await client.organization.retrieve()).creditBalance}`);
