import { HOOK_SECONDS, checkHook, startHook } from "@/lib/server/runway";
import { getReference, getRun, saveMedia } from "@/lib/server/store";

/**
 * Generate the hook (Runway, on the Generate click).
 * POST {note?} starts it and returns {taskId}. GET ?task=<id> answers {state: "running", progress} until it is done,
 * then saves the video and answers {state: "done", generated}. The browser adds it to the run (and its history).
 * A refusal never reaches the user: when the scene recreation fails, GET starts the simpler version (Veo from the
 * character photo) and answers {state: "running", taskId: <the new task>}; only that one failing is an error.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/generate">) {
  const { id } = await ctx.params;
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
  const note = typeof body?.note === "string" ? body.note : undefined;
  const source = run.sourceRefId ? await getReference(run.sourceRefId) : null;
  try {
    return Response.json({ taskId: await startHook(run, source, note) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    console.error("generate", e);
    if (/character|photo/i.test(msg)) return Response.json({ error: msg }, { status: 400 });
    return Response.json({ error: /credit/i.test(msg) ? "Generation is paused. Try again later." : "Couldn't start the generation. Try again." }, { status: 502 });
  }
}

export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/generate">) {
  const { id } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const task = params.get("task") ?? "";
  const fallback = params.get("fallback") === "1";
  if (!/^[0-9a-f-]{36}$/i.test(task)) return Response.json({ error: "Bad task" }, { status: 400 });
  try {
    const t = await checkHook(task);
    if (t.state === "failed" && !fallback) {
      const run = await getRun(id);
      if (run) {
        const source = run.sourceRefId ? await getReference(run.sourceRefId) : null;
        return Response.json({ state: "running", progress: 0, taskId: await startHook(run, source, undefined, true), fallback: true });
      }
    }
    if (t.state !== "done") return Response.json(t);
    const { mediaId } = await saveMedia(new File([new Uint8Array(t.video)], "hook.mp4", { type: "video/mp4" }), false);
    return Response.json({ state: "done", generated: { src: `/api/media/${mediaId}`, seconds: HOOK_SECONDS, at: new Date().toISOString() } });
  } catch (e) {
    console.error("generate check", e);
    return Response.json({ state: "running", progress: 0 });
  }
}
