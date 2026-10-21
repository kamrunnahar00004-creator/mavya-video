import { HOOK_SECONDS, checkHook, startHook } from "@/lib/server/runway";
import { getReference, getRun, saveMedia } from "@/lib/server/store";
import { allowance, recordGeneration, refundGeneration } from "@/lib/server/usage";
import { currentUser, signInFirst } from "@/lib/server/who";

/**
 * Generate the hook (Runway, on the Generate click).
 * POST {note?} checks the plan's AI hooks, starts it and returns {taskId, generationId}.
 * GET ?task=<id>&gen=<generationId> answers {state: "running", progress} until it is done, then saves the video and
 * answers {state: "done", generated}. The browser adds it to the run (and its history).
 * A refusal never reaches the user: when the scene recreation fails, GET starts the simpler version (Veo from the
 * character photo) and answers {state: "running", taskId: <the new task>, fallback: true}; that is not counted again.
 * If the fallback fails too, the hook is given back.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/generate">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const run = await getRun(id, who);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const left = await allowance(who);
  if (left.limit !== null && left.used >= left.limit) {
    return Response.json({ error: left.limit === 0 ? "Choose a plan to make AI hooks." : "You've used this month's AI hooks. Upgrade for more.", needsPlan: true }, { status: 402 });
  }
  const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
  const note = typeof body?.note === "string" ? body.note : undefined;
  const source = run.sourceRefId ? await getReference(run.sourceRefId, who) : null;
  try {
    const taskId = await startHook(run, source, who, note);
    return Response.json({ taskId, generationId: await recordGeneration(who, run.id) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    console.error("generate", e);
    if (/character|photo/i.test(msg)) return Response.json({ error: msg }, { status: 400 });
    return Response.json({ error: /credit/i.test(msg) ? "Generation is paused. Try again later." : "Couldn't start the generation. Try again." }, { status: 502 });
  }
}

export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/generate">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const params = new URL(request.url).searchParams;
  const task = params.get("task") ?? "";
  const gen = params.get("gen") ?? "";
  const fallback = params.get("fallback") === "1";
  if (!/^[0-9a-f-]{36}$/i.test(task)) return Response.json({ error: "Bad task" }, { status: 400 });
  try {
    const t = await checkHook(task);
    if (t.state === "failed") {
      const run = !fallback ? await getRun(id, who) : null;
      if (run) {
        const source = run.sourceRefId ? await getReference(run.sourceRefId, who) : null;
        return Response.json({ state: "running", progress: 0, taskId: await startHook(run, source, who, undefined, true), fallback: true });
      }
      if (gen) await refundGeneration(who, gen);
      return Response.json(t);
    }
    if (t.state !== "done") return Response.json(t);
    const { mediaId } = await saveMedia(new File([new Uint8Array(t.video)], "hook.mp4", { type: "video/mp4" }), false, who);
    return Response.json({ state: "done", generated: { src: `/api/media/${mediaId}`, seconds: HOOK_SECONDS, at: new Date().toISOString() } });
  } catch (e) {
    console.error("generate check", e);
    return Response.json({ state: "running", progress: 0 });
  }
}
