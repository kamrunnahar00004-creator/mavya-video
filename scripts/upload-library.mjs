// One-time move from this laptop to the cloud (safe to re-run: it skips what is already there).
// 1. (--cors only) R2 CORS, so the app's pages can read video frames from storage.
// 2. The curated library: every hook's full video, cut hook clip, cut demo clip and extracted sound -> R2
//    (library/<kind>/<code>.*), covers -> R2 media/<id> (shared), records -> Supabase `library`.
// 3. The founder's own runs and uploads -> R2 media/<id> + Supabase `runs`, `media`, `assets` (owner = OWNER_EMAIL).
// Usage: node --env-file=.env.local scripts/upload-library.mjs [--library] [--mine] [--cors]   (default: all)
// Needs supabase/migrations/0002_storage.sql applied first.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HeadObjectCommand, PutBucketCorsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const ROOT = "/home/farhan/mavya-video";
const DATA = `${ROOT}/.data`;
const FF = `${ROOT}/node_modules/ffmpeg-static/ffmpeg`;
const e = process.env;
const args = new Set(process.argv.slice(2));
const all = !args.has("--library") && !args.has("--mine") && !args.has("--cors");
const s3 = new S3Client({ region: "auto", endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY } });
const Bucket = e.R2_BUCKET;
const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = JSON.parse(readFileSync(`${DATA}/db.json`, "utf8"));
const MIME = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", jpg: "image/jpeg", png: "image/png", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav" };
const code = (r) => (r.sourceUrl ?? "").replace(/\/+$/, "").split("/").pop();
const has = async (Key) => s3.send(new HeadObjectCommand({ Bucket, Key })).then(() => true, () => false);
const put = async (Key, file, ContentType) => s3.send(new PutObjectCommand({ Bucket, Key, Body: readFileSync(file), ContentType }));
const check = ({ error }) => { if (error) throw new Error(error.message); };
let uploaded = 0, skipped = 0;
async function upload(Key, file, mime) {
  if (!existsSync(file)) return false;
  if (await has(Key)) { skipped++; return true; }
  await put(Key, file, mime);
  uploaded++;
  return true;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const item = items[i++]; await fn(item); } }));
}

// Needs an R2 token with admin rights; with an Object Read & Write token, set the same rule in the Cloudflare dashboard.
if (args.has("--cors")) {
  await s3.send(new PutBucketCorsCommand({
    Bucket,
    CORSConfiguration: { CORSRules: [{ AllowedOrigins: ["https://mavya.app", "https://www.mavya.app", "http://localhost:3100", "http://127.0.0.1:3100"], AllowedMethods: ["GET", "HEAD", "PUT"], AllowedHeaders: ["*"], ExposeHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"], MaxAgeSeconds: 3600 }] },
  }));
  console.log("cors set");
}

if (all || args.has("--library")) {
  const refs = db.references.filter((r) => (r.owner ?? "curated") === "curated");
  console.log(`library: ${refs.length} hooks`);
  const tmp = mkdtempSync(path.join(tmpdir(), "mavya-audio-"));
  let done = 0;
  await pool(refs, 6, async (r) => {
    const c = code(r);
    if (/^[A-Za-z0-9_-]{5,40}$/.test(c)) {
      for (const kind of ["sources", "hooks", "demos"]) await upload(`library/${kind}/${c}.mp4`, `${DATA}/${kind}/${c}.mp4`, "video/mp4");
      // The hook's own sound, extracted once here so the server never runs ffmpeg for it.
      const audioKey = `library/audio/${c}.m4a`;
      if (existsSync(`${DATA}/sources/${c}.mp4`) && !(await has(audioKey))) {
        const out = `${tmp}/${c}.m4a`;
        try {
          execFileSync(FF, ["-nostdin", "-v", "error", "-y", "-i", `${DATA}/sources/${c}.mp4`, "-vn", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out]);
          await put(audioKey, out, "audio/mp4");
          uploaded++;
        } catch { /* no usable audio track */ }
      }
    }
    // The cover (and any file of the reference) is shared media everyone may read.
    for (const src of [r.thumbUrl, r.mediaId && `/api/media/${r.mediaId}`]) {
      const id = typeof src === "string" && src.startsWith("/api/media/") ? src.split("/").pop() : null;
      if (!id) continue;
      const ext = id.split(".").pop();
      if (await upload(`media/${id}`, `${DATA}/media/${id}`, MIME[ext])) {
        check(await sb.from("media").upsert({ id, user_id: null, mime: MIME[ext], size: statSync(`${DATA}/media/${id}`).size }, { onConflict: "id" }));
      }
    }
    check(await sb.from("library").upsert({ id: r.id, owner: "curated", user_id: null, data: r, created_at: r.createdAt ?? new Date().toISOString() }, { onConflict: "id" }));
    if (++done % 25 === 0) console.log(`  ${done}/${refs.length} (uploaded ${uploaded}, already there ${skipped})`);
  });
  rmSync(tmp, { recursive: true, force: true });
  console.log(`library done: ${done} records, uploaded ${uploaded} files, ${skipped} already there`);
}

if (all || args.has("--mine")) {
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const owner = users.users.find((u) => u.email?.toLowerCase() === (e.OWNER_EMAIL ?? "").toLowerCase());
  if (!owner) throw new Error("Set OWNER_EMAIL to your sign-in email (sign in once first).");
  // Every media file the runs and uploads use.
  const ids = new Set(db.assets.map((a) => a.mediaId));
  JSON.stringify(db.runs).replace(/\/api\/media\/([0-9a-f-]{36}\.[a-z0-9]{2,4})/g, (_, id) => ids.add(id));
  JSON.stringify(db.runs).replace(/"mediaId":"([0-9a-f-]{36}\.[a-z0-9]{2,4})"/g, (_, id) => ids.add(id));
  const userRefs = db.references.filter((r) => r.owner === "user");
  for (const r of userRefs) if (r.mediaId) ids.add(r.mediaId);
  console.log(`yours: ${db.runs.length} runs, ${db.assets.length} uploads, ${userRefs.length} own hooks, ${ids.size} files`);
  await pool([...ids], 6, async (id) => {
    const file = `${DATA}/media/${id}`;
    const ext = id.split(".").pop();
    if (!(await upload(`media/${id}`, file, MIME[ext]))) return;
    const { data: row } = await sb.from("media").select("id").eq("id", id).maybeSingle();
    if (!row) check(await sb.from("media").insert({ id, user_id: owner.id, mime: MIME[ext], size: statSync(file).size }));
  });
  for (const a of db.assets) {
    if (!existsSync(`${DATA}/media/${a.mediaId}`)) continue;
    check(await sb.from("assets").upsert({ media_id: a.mediaId, user_id: owner.id, name: a.name, kind: a.kind, created_at: a.createdAt }, { onConflict: "media_id" }));
  }
  for (const r of userRefs) check(await sb.from("library").upsert({ id: r.id, owner: "user", user_id: owner.id, data: r, created_at: r.createdAt }, { onConflict: "id" }));
  for (const r of db.runs) check(await sb.from("runs").upsert({ id: r.id, user_id: owner.id, data: r, created_at: r.createdAt, updated_at: r.updatedAt ?? r.createdAt }, { onConflict: "id" }));
  console.log(`yours done: uploaded ${uploaded} files, ${skipped} already there`);
}
