import { deleteRun, getRun, updateRun } from "@/lib/server/store";
import type { Run } from "@/lib/types";
import { validRunPatch } from "@/lib/server/run-validation";
import { currentUser, signInFirst } from "@/lib/server/who";
import { renderLimitError } from "@/lib/render-limits";
import { timeline, videoLength } from "@/lib/edit";

export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const run = await getRun(id, who);
  return run ? Response.json(run) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Local prototype: the browser sends whole run sections (title, hook, demo, project). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const body = (await request.json().catch(() => null)) as Partial<Run> | null;
  if (body) {
    const candidates = [body.hook, ...(Array.isArray(body.demo?.clips) ? body.demo.clips : [])].filter(Boolean);
    const bounds = renderLimitError(candidates as Parameters<typeof renderLimitError>[0], body.texts?.length, body.sounds?.length);
    if (bounds) return Response.json({ error: bounds }, { status: 400 });
  }
  if (!validRunPatch(body)) return Response.json({ error: "Invalid run sections" }, { status: 400 });
  if (body?.hook || body?.demo) {
    const current = await getRun(id, who);
    if (!current) return Response.json({ error: "Not found" }, { status: 404 });
    const merged = { ...current, ...body };
    const segments = timeline(merged, null);
    const bounds = renderLimitError(segments, merged.texts?.length, merged.sounds?.length, videoLength(segments.filter(s => s.src)));
    if (bounds) return Response.json({ error: bounds }, { status: 400 });
  }
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });
  const patch: Partial<Omit<Run, "id" | "createdAt">> = {};
  if (typeof body.title === "string") patch.title = body.title.trim().slice(0, 140) || "Untitled run";
  if (body.sourceRefId === null || typeof body.sourceRefId === "string") patch.sourceRefId = body.sourceRefId;
  if (body.hook && typeof body.hook === "object") patch.hook = body.hook;
  if (body.demo && typeof body.demo === "object") patch.demo = body.demo;
  if (Array.isArray(body.texts)) patch.texts = body.texts;
  if (body.project === null || (body.project && typeof body.project === "object")) patch.project = body.project;
  if (Array.isArray(body.sounds)) {
    const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    patch.sounds = body.sounds
      .slice(0, 20)
      // Sounds only play from our own files: an upload, a saved song, or a library video on disk.
      .filter((s) => s && typeof s.src === "string" && /^\/api\/(media|sounds)\/[A-Za-z0-9._-]+$/.test(s.src) && ["hook", "song", "upload"].includes(s.kind))
      .map((s) => ({
        id: String(s.id ?? "").slice(0, 40) || Math.random().toString(36).slice(2, 10),
        kind: s.kind,
        src: s.src,
        name: String(s.name ?? "").slice(0, 120),
        ...(typeof s.refId === "string" ? { refId: s.refId } : {}),
        at: num(s.at, 0, 3600, 0),
        ...(typeof s.end === "number" ? { end: num(s.end, 0, 3600, 0) } : {}),
        ...(typeof s.row === "number" ? { row: Math.round(num(s.row, 0, 20, 0)) } : {}),
        start: num(s.start, 0, 3600, 0),
        volume: num(s.volume, 0, 100, 100),
        ...(typeof s.length === "number" ? { length: num(s.length, 0, 3600, 0) } : {}),
      }));
  }
  if (body.sound === null) patch.sound = null;
  else if (body.sound && typeof body.sound === "object") {
    const s = body.sound;
    // Sounds only play from our own files: an upload, or a library video on disk.
    if (typeof s.src === "string" && /^\/api\/(media|sounds)\/[A-Za-z0-9._-]+$/.test(s.src) && ["hook", "song", "upload"].includes(s.kind)) {
      const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
      patch.sound = {
        kind: s.kind,
        src: s.src,
        name: String(s.name ?? "").slice(0, 120),
        ...(typeof s.refId === "string" ? { refId: s.refId } : {}),
        start: num(s.start, 0, 3600, 0),
        ...(typeof s.at === "number" ? { at: num(s.at, 0, 3600, 0) } : {}),
        ...(typeof s.end === "number" ? { end: num(s.end, 0, 3600, 0) } : {}),
        volume: num(s.volume, 0, 100, 100),
        ...(typeof s.length === "number" ? { length: num(s.length, 0, 3600, 0) } : {}),
      };
    }
  }
  const run = await updateRun(id, patch, who);
  return run ? Response.json(run) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  try { await deleteRun(id, who); }
  catch { return Response.json({ error: "Couldn't delete the video. Try again." }, { status: 503 }); }
  return new Response(null, { status: 204 });
}
