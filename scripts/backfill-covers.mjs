// One-time (safe to re-run): small WebP card covers for every library item that has a stored thumbnail.
// Writes R2 covers/<thumbnail media id>.webp (360 px wide) and sets data.smallCover = true on the library row.
// New items get theirs automatically the first time the library lists them (src/lib/server/covers.ts).
// Usage: node --env-file=.env.local scripts/backfill-covers.mjs [--dry]
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const dry = process.argv.includes("--dry");
const r2 = new S3Client({
  region: "auto",
  requestChecksumCalculation: "WHEN_REQUIRED",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const Bucket = process.env.R2_BUCKET;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const MEDIA_ID = /\/api\/media\/([0-9a-f-]{36}(?:\.[a-z0-9]{2,5})?)/;

const rows = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await db.from("library").select("id,data").eq("owner", "curated").order("id").range(from, from + 499);
  if (error) throw error;
  rows.push(...data);
  if (data.length < 500) break;
}
const todo = rows
  .map((row) => ({ id: row.id, mediaId: (row.data.analysis?.segments?.[0]?.thumb ?? row.data.thumbUrl ?? "").match(MEDIA_ID)?.[1], done: row.data.smallCover === true }))
  .filter((row) => row.mediaId && !row.done);
console.log(`${rows.length} library rows, ${todo.length} need a cover${dry ? " (dry run)" : ""}`);
if (dry) process.exit(0);

let ok = 0, failed = 0, before = 0, after = 0;
async function one({ id, mediaId }) {
  try {
    const got = await r2.send(new GetObjectCommand({ Bucket, Key: `media/${mediaId}` }));
    const original = Buffer.from(await got.Body.transformToByteArray());
    const webp = await sharp(original).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    await r2.send(new PutObjectCommand({ Bucket, Key: `covers/${mediaId}.webp`, Body: webp, ContentType: "image/webp" }));
    // Re-read just before writing so only the cover flag changes.
    const { data, error } = await db.from("library").select("data").eq("id", id).single();
    if (error) throw error;
    const currentMedia = (data.data.analysis?.segments?.[0]?.thumb ?? data.data.thumbUrl ?? "").match(MEDIA_ID)?.[1];
    if (currentMedia !== mediaId) throw new Error("Thumbnail changed during backfill");
    const updated = await db.from("library").update({ data: { ...data.data, smallCover: true } }).eq("id", id).eq("owner", "curated").eq("data", data.data).select("id");
    if (!updated.error && !updated.data?.length) throw new Error("Concurrent edit, retry later");
    if (updated.error) throw updated.error;
    ok++; before += original.length; after += webp.length;
  } catch (error) {
    failed++;
    console.error("failed", id, error.message ?? error);
  }
}
for (let i = 0; i < todo.length; i += 6) {
  await Promise.all(todo.slice(i, i + 6).map(one));
  process.stdout.write(`\r${Math.min(i + 6, todo.length)}/${todo.length}`);
}
console.log(`\ndone: ${ok} covers, ${failed} failed. Avg original ${ok ? Math.round(before / ok / 1024) : 0} KB -> cover ${ok ? Math.round(after / ok / 1024) : 0} KB`);
