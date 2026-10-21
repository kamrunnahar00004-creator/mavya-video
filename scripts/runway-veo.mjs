// Generate hooks exactly like the app's Generate button (src/lib/server/runway.ts: Veo 3.1 Fast, character photo as
// the first frame, the hook recipe's beats as the action), for checking quality without clicking through the app.
// Usage: node --env-file=.env.local scripts/runway-veo.mjs <character>:<shortcode> [...]
// Writes .data/runway-test/<character>-<code>-veo.mp4
import { readFileSync, writeFileSync } from "node:fs";
import RunwayML from "@runwayml/sdk";

const ROOT = "/home/farhan/mavya-video";
const client = new RunwayML();
const db = JSON.parse(readFileSync(`${ROOT}/.data/db.json`, "utf8"));
const NO_TEXT = "No text, captions, subtitles, stickers or watermarks anywhere in the frame.";
const BODY = "Natural, anatomically correct hands with five fingers, no extra limbs, no props or accessories that are not in the photo.";
const NEGATIVE = "text, captions, subtitles, watermark, logo, extra fingers, deformed hands, distorted face, morphing";

await Promise.all(
  process.argv.slice(2).map(async (pair) => {
    const [character, code] = pair.split(":");
    const hook = db.references.find((r) => (r.sourceUrl ?? "").includes(code))?.recipe?.hook ?? {};
    const action = (hook.beats ?? []).map((b) => `${b.start.toFixed(1)}-${b.end.toFixed(1)}s: ${b.action.replaceAll("{CHARACTER}", "the person")}`).join(" ");
    const prompt = `Vertical selfie video filmed on a phone, ${hook.camera ?? "handheld front-facing selfie, close-up"}. The person in the image, in the same place as in the image. ${hook.mood ? `Mood: ${hook.mood}.` : ""} Action: ${action} Realistic, natural motion. ${BODY} ${NO_TEXT}`;
    const t0 = Date.now();
    const task = await client.imageToVideo
      .create({
        model: "veo3.1_fast",
        promptImage: [{ uri: `data:image/jpeg;base64,${readFileSync(`${ROOT}/public/characters/${character}.jpg`).toString("base64")}`, position: "first" }],
        promptText: prompt.slice(0, 1000),
        negativePrompt: NEGATIVE,
        ratio: "720:1280",
        duration: 4,
        audio: false,
      })
      .waitForTaskOutput({ timeout: 10 * 60 * 1000 });
    const dest = `${ROOT}/.data/runway-test/${character}-${code}-veo.mp4`;
    writeFileSync(dest, Buffer.from(await (await fetch(task.output[0])).arrayBuffer()));
    console.log(`${character} on ${code}: done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }),
);
console.log(`credits left: ${(await client.organization.retrieve()).creditBalance}`);
