// One Gemini Omni Flash 1.1 "edit" replacement (the original hook stays; only the person becomes the character),
// printing the full error when it fails. Usage: node --env-file=.env.local scripts/runway-gemini.mjs <character>:<shortcode>
import { readFileSync, writeFileSync } from "node:fs";
import RunwayML from "@runwayml/sdk";

const ROOT = "/home/farhan/mavya-video";
const client = new RunwayML();
const PROMPT =
  "Replace the person in this video with the person in the reference image: their face, hair, skin tone and body. " +
  "Keep everything else exactly the same: the room, background, camera angle and movement, lighting, clothes, every gesture, expression and its timing. " +
  "Natural hands with five fingers. Remove all on-screen text, captions and stickers.";
const [character, code] = process.argv[2].split(":");
const dataUri = (p, mime) => `data:${mime};base64,${readFileSync(p).toString("base64")}`;
const t0 = Date.now();
try {
  const created = await client.videoToVideo.create({
    model: "gemini_omni_flash_1.1",
    mode: "edit",
    videoUri: dataUri(`${ROOT}/.data/hooks/${code}.mp4`, "video/mp4"),
    references: [{ uri: dataUri(`${ROOT}/public/characters/${character}.jpg`, "image/jpeg") }],
    promptText: PROMPT,
  });
  console.log("task", created.id);
  let task;
  do {
    await new Promise((r) => setTimeout(r, 5000));
    task = await client.tasks.retrieve(created.id);
  } while (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(task.status));
  if (task.status !== "SUCCEEDED") {
    console.log("status", task.status, JSON.stringify(task).slice(0, 600));
    process.exit(1);
  }
  writeFileSync(`${ROOT}/.data/runway-test/${character}-${code}-gemini.mp4`, Buffer.from(await (await fetch(task.output[0])).arrayBuffer()));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} catch (e) {
  console.log("error", e?.status, JSON.stringify(e?.error ?? e?.message).slice(0, 600));
  process.exit(1);
}
