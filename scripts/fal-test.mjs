// Side test (founder-approved, 2026-10-23): character replacement on fal.ai vs the current Veo method.
// Wan 2.2 Animate Replace (hook clip, 720p) and H3 Max Recast (first 6 s of the source, 768P; it needs 5-30 s).
// Inputs are short-lived R2 links to the library clips and the public character photo on mavya.app.
// Usage: node --env-file=.env.local scripts/fal-test.mjs <outDir>
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const e = process.env;
const out = process.argv[2];
const FF = "node_modules/ffmpeg-static/ffmpeg";
const s3 = new S3Client({ region: "auto", endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY } });
const sign = (Key) => getSignedUrl(s3, new GetObjectCommand({ Bucket: e.R2_BUCKET, Key }), { expiresIn: 7200 });
const H = { Authorization: `Key ${e.FAL_KEY}`, "content-type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Queue a request, wait for it, return the result JSON. */
async function fal(model, input, label) {
  const t = Date.now();
  const q = await (await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: H, body: JSON.stringify(input) })).json();
  if (!q.request_id) throw new Error(`${label}: ${JSON.stringify(q).slice(0, 300)}`);
  for (;;) {
    await sleep(5000);
    const s = await (await fetch(q.status_url, { headers: H })).json();
    if (s.status === "COMPLETED") break;
    if (s.status !== "IN_QUEUE" && s.status !== "IN_PROGRESS") throw new Error(`${label}: ${JSON.stringify(s).slice(0, 300)}`);
  }
  const r = await (await fetch(q.response_url, { headers: H })).json();
  if (!r.video?.url) throw new Error(`${label}: ${JSON.stringify(r).slice(0, 400)}`);
  console.log(`${label}: done in ${Math.round((Date.now() - t) / 1000)}s`);
  return r;
}

async function save(url, file) {
  writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  return file;
}

// The first 6 s of a library source, uploaded to a temporary R2 key (Recast needs 5-30 s).
async function first6(code) {
  const dir = mkdtempSync(path.join(tmpdir(), "fal-"));
  const src = path.join(dir, "src.mp4");
  await save(await sign(`library/sources/${code}.mp4`), src);
  const cut = path.join(dir, "cut.mp4");
  execFileSync(FF, ["-v", "error", "-y", "-i", src, "-t", "6", "-c:v", "libx264", "-crf", "16", "-c:a", "aac", cut]);
  const Key = `tmp/fal/${code}-6s.mp4`;
  await s3.send(new PutObjectCommand({ Bucket: e.R2_BUCKET, Key, Body: readFileSync(cut), ContentType: "video/mp4" }));
  return Key;
}

const tests = [
  { name: "A", code: "Da9dDfqC3a2", who: "priya" },
  { name: "B", code: "DSVXKrvjPeW", who: "olivia" },
];
const temp = [];
await Promise.all(
  tests.map(async (t) => {
    const photo = `https://mavya.app/characters/${t.who}.jpg`;
    const hook = await sign(`library/hooks/${t.code}.mp4`);
    const longKey = await first6(t.code);
    temp.push(longKey);
    const jobs = [
      fal("fal-ai/wan/v2.2-14b/animate/replace", { video_url: hook, image_url: photo, resolution: "720p", video_quality: "high" }, `${t.name} wan`)
        .then((r) => save(r.video.url, `${out}/fal-${t.name}-wan.mp4`))
        .catch((err) => console.log(String(err))),
      fal("minimax/h3-max/recast", { video_url: await sign(longKey), reference_image_urls: [photo], resolution: "768P", enhance_realism: true }, `${t.name} recast`)
        .then((r) => save(r.video.url, `${out}/fal-${t.name}-recast.mp4`))
        .catch((err) => console.log(String(err))),
    ];
    await Promise.all(jobs);
  }),
);
for (const Key of temp) await s3.send(new DeleteObjectCommand({ Bucket: e.R2_BUCKET, Key }));
console.log("all done");
