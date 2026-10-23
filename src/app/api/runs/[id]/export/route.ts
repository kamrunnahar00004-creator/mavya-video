import { randomUUID } from "node:crypto";
import { fullAdjust } from "@/lib/adjust";
import { segSpeed, timeline, videoLength } from "@/lib/edit";
import { deleteObject, putObject, signedGet } from "@/lib/server/r2";
import { cloud, getRun, isMediaId, libraryLink, mediaAccess, mediaLink, mediaUploadLink, newUpload, registerMedia, updateRun, uploadedSize } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";
import { pieceEnd, soundPieces } from "@/lib/sound";

/**
 * Export: the finished MP4, built by the render server (render/server.mjs on Render.com, RENDER_URL + RENDER_SECRET).
 * POST {texts: [{png, start, end}]}: the browser draws each on-screen text as a full-frame transparent PNG (the same
 * CSS as the preview). This route stores them, turns the run into a render spec with short-lived R2 links (the
 * server never sees our keys), gives the server one signed upload link for the result and returns {job}.
 * GET ?job=<id>: the job's state; once done, the MP4 is recorded as the user's media and added to the run's exports.
 */
export const maxDuration = 60;

const W = 1080;
const H = 1920;
const FPS = 30;
const LINK_SECONDS = 6 * 3600;
const MAX_TEXTS = 40;
const MAX_PNG = 3_000_000;

type Meta = { who: string; runId: string; mediaId: string; tmp: string; overlays: number; seconds: number };

const renderer = () => (process.env.RENDER_URL && process.env.RENDER_SECRET ? { url: process.env.RENDER_URL.replace(/\/+$/, ""), secret: process.env.RENDER_SECRET } : null);

/** A link the render server can download a run's file from (null when it is not this user's). */
async function inputLink(src: string, who: string, origin: string): Promise<string | null> {
  const media = /^\/api\/media\/([^/?#]+)$/.exec(src);
  if (media) return (await mediaAccess(media[1], who)) ? mediaLink(media[1], LINK_SECONDS) : null;
  const sound = /^\/api\/sounds\/([A-Za-z0-9_-]+)$/.exec(src);
  if (sound) return libraryLink("audio", sound[1], LINK_SECONDS);
  // Files that ship with the app (public/).
  if (/^\/(samples|landing|characters)\//.test(src)) return `${origin}${src}`;
  return null;
}

export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/export">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const render = renderer();
  if (!cloud() || !render) return Response.json({ error: "Export is not connected yet." }, { status: 503 });
  const run = await getRun(id, who);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  if (!run.hook.generated) return Response.json({ error: "Generate the hook first." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { texts?: unknown } | null;
  const texts = Array.isArray(body?.texts) ? (body.texts as { png?: unknown; x?: unknown; y?: unknown; start?: unknown; end?: unknown }[]).slice(0, MAX_TEXTS) : [];
  const origin = new URL(request.url).origin;
  const segs = timeline(run, null).filter((s) => s.src);
  const total = videoLength(segs);
  if (!segs.length || total <= 0) return Response.json({ error: "Nothing to export yet." }, { status: 400 });
  if (total > 180) return Response.json({ error: "Videos can be up to 3 minutes." }, { status: 400 });

  const segments = [];
  for (const s of segs) {
    const url = await inputLink(s.src!, who, origin);
    if (!url) return Response.json({ error: `A clip in "${s.label}" can't be found. Upload it again.` }, { status: 400 });
    const a = fullAdjust(s.adjust);
    segments.push({
      url,
      gap: s.gap,
      speed: segSpeed(s),
      volume: s.editable ? a.volume / 100 : 0,
      look: s.editable ? { brightness: a.brightness, contrast: a.contrast, saturation: a.saturation, warmth: a.warmth, zoom: a.zoom, panX: a.panX, panY: a.panY, flip: a.flip, keys: a.keys } : null,
      pieces: s.parts.map((p) => ({ start: p.start, end: p.end })),
    });
  }

  const pieces = soundPieces(run, total);
  const sounds = [];
  for (const [i, p] of pieces.entries()) {
    const end = pieceEnd(pieces, i, total);
    if (end - p.at < 0.05 || p.volume <= 0) continue;
    const url = await inputLink(p.src, who, origin);
    if (url) sounds.push({ url, at: p.at, dur: end - p.at, start: p.start, volume: p.volume / 100 });
  }

  // The texts' PNGs, kept only for this export.
  const tmp = randomUUID();
  const overlays = [];
  for (const [i, t] of texts.entries()) {
    const m = typeof t.png === "string" ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(t.png) : null;
    const [start, end, x, y] = [Number(t.start), Number(t.end), Number(t.x), Number(t.y)];
    if (!m || ![start, end, x, y].every(Number.isFinite) || end <= start || start >= total) continue;
    const png = Buffer.from(m[1], "base64");
    if (png.length > MAX_PNG || png.subarray(1, 4).toString() !== "PNG") continue;
    const key = `tmp/exports/${tmp}/${i}.png`;
    await putObject(key, png, "image/png");
    overlays.push({ url: await signedGet(key, LINK_SECONDS), start: Math.max(0, start), end: Math.min(total, end), x: Math.max(0, Math.min(W, x)), y: Math.max(0, Math.min(H, y)) });
  }

  const { mediaId } = newUpload("video/mp4");
  const meta: Meta = { who, runId: run.id, mediaId, tmp, overlays: texts.length, seconds: Math.round(total * 10) / 10 };
  try {
    const res = await fetch(`${render.url}/jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${render.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ spec: { width: W, height: H, fps: FPS, total, segments, sounds, overlays }, output: { url: await mediaUploadLink(mediaId, "video/mp4", LINK_SECONDS), contentType: "video/mp4" }, meta }),
      // A sleeping server takes up to a minute to wake.
      signal: AbortSignal.timeout(55_000),
    });
    const job = (await res.json().catch(() => null)) as { id?: string } | null;
    if (!res.ok || !job?.id) throw new Error(`render ${res.status}`);
    return Response.json({ job: job.id });
  } catch (e) {
    console.error("export start", e);
    await cleanup(tmp, texts.length);
    return Response.json({ error: "Export is busy. Try again in a minute." }, { status: 502 });
  }
}

async function cleanup(tmp: string, n: number) {
  await Promise.all(Array.from({ length: n }, (_, i) => deleteObject(`tmp/exports/${tmp}/${i}.png`)));
}

export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/export">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const render = renderer();
  const jobId = new URL(request.url).searchParams.get("job") ?? "";
  if (!render || !/^[0-9a-f-]{36}$/.test(jobId)) return Response.json({ error: "Not found" }, { status: 404 });
  const res = await fetch(`${render.url}/jobs/${jobId}`, { headers: { authorization: `Bearer ${render.secret}` }, cache: "no-store", signal: AbortSignal.timeout(55_000) }).catch(() => null);
  if (res?.status === 404) return Response.json({ state: "failed", error: "The export was interrupted. Try again." });
  const job = (await res?.json().catch(() => null)) as { state?: string; progress?: number; meta?: Meta; error?: string; ahead?: number } | null;
  if (!res?.ok || !job?.state) return Response.json({ state: "running", progress: 0 });
  const meta = job.meta;
  // Only the user who started it, for this run.
  if (!meta || meta.who !== who || meta.runId !== id || !isMediaId(meta.mediaId)) return Response.json({ error: "Not found" }, { status: 404 });

  if (job.state === "failed") {
    console.error("export failed", jobId, job.error);
    await cleanup(meta.tmp, meta.overlays);
    return Response.json({ state: "failed", error: "The export failed. Try again." });
  }
  if (job.state !== "done") return Response.json({ state: job.state, progress: job.progress ?? 0, ahead: job.ahead ?? 0 });

  const src = `/api/media/${meta.mediaId}`;
  const run = await getRun(id, who);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  if (!run.exports?.some((x) => x.src === src)) {
    const size = await uploadedSize(meta.mediaId);
    if (!size) return Response.json({ state: "failed", error: "The export failed. Try again." });
    try {
      await registerMedia(meta.mediaId, "video/mp4", size, who, null);
    } catch (e) {
      // Already recorded by an earlier check.
      if ((e as { code?: string }).code !== "23505") throw e;
    }
    const done = { src, seconds: meta.seconds, at: new Date().toISOString() };
    await updateRun(id, { exports: [...(run.exports ?? []), done] }, who);
    await cleanup(meta.tmp, meta.overlays);
    return Response.json({ state: "done", export: done });
  }
  return Response.json({ state: "done", export: run.exports.find((x) => x.src === src) });
}
