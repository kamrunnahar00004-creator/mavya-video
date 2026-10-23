// Side test (2026-10-23): can the original creator's burned-in captions be removed?
// 1. Bria Video Erase (prompt) on the library hook clips (clean once, reuse forever).
// 2. H3 Max Recast with a prompt to drop the on-screen text (no extra cost if it works).
// Usage: node --env-file=.env.local scripts/fal-erase-test.mjs <outDir>
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
const save = async (url, file) => writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));

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

const ERASE = "the white caption text and emoji overlaid on the video";
const jobs = [];
for (const [name, code] of [["A", "Da9dDfqC3a2"], ["B", "DSVXKrvjPeW"]]) {
  jobs.push(
    fal("bria/video/erase/prompt", { video_url: await sign(`library/hooks/${code}.mp4`), prompt: ERASE, auto_trim: true }, `${name} erase`)
      .then((r) => save(r.video.url, `${out}/fal-${name}-erased.mp4`))
      .catch((err) => console.log(String(err))),
  );
}
const longKey = await first6("DSVXKrvjPeW");
jobs.push(
  fal("minimax/h3-max/recast", { video_url: await sign(longKey), reference_image_urls: ["https://mavya.app/characters/olivia.jpg"], resolution: "768P", enhance_realism: true, prompt: "Replace the man with the woman in the photo. Remove all on-screen text, captions and emoji overlays: the video must have no text at all. Keep everything else the same." }, "B recast-notext")
    .then((r) => save(r.video.url, `${out}/fal-B-recast-notext.mp4`))
    .catch((err) => console.log(String(err))),
);
await Promise.all(jobs);
await s3.send(new DeleteObjectCommand({ Bucket: e.R2_BUCKET, Key: longKey }));
console.log("all done");
