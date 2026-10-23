import { after } from "next/server";
import { advanceGeneration, generationJob, generationReply, reserveGeneration } from "@/lib/server/generation-jobs";
import { cloud, getRun } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";
import { expireTemporaryObjects } from "@/lib/server/temp-cleanup";

// Hobby plan maximum (founder 2026-10-23: stay on Hobby for now); one Kling start or check fits well inside it.
export const maxDuration = 300;
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const continueJob = (who: string, job: string) => after(async () => {
  try { await advanceGeneration(who, job); } catch (error) { console.error("generation worker", job, error); }
});

/** The browser gets only a server-owned job ID, never provider/refund/fallback authority. */
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/generate">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  if (!cloud()) return Response.json({ error: "Generation is unavailable." }, { status: 503 });
  const body = await request.json().catch(() => null) as { key?: unknown; note?: unknown } | null;
  if (typeof body?.key !== "string" || !uuid(body.key)) return Response.json({ error: "Invalid request." }, { status: 400 });
  try {
    const reserved = await reserveGeneration(who, id, body.key, typeof body.note === "string" ? body.note.slice(0, 300) : undefined);
    if (reserved.error === "quota") return Response.json({ error: reserved.allowance?.limit === 0 ? "Choose a plan to make AI hooks." : "You've used this month's AI hooks. Upgrade for more.", needsPlan: true }, { status: 402 });
    if (!reserved.job) return Response.json({ error: "Not found" }, { status: reserved.error === "conflict" ? 409 : 404 });
    continueJob(who, reserved.job.id);
    return Response.json(await generationReply(reserved.job));
  } catch (error) {
    console.error("generation reservation", error);
    return Response.json({ error: "Generation is unavailable. Try again." }, { status: 503 });
  }
}

/** No job parameter resumes this run's unfinished job on reload. Explicit polls require ownership. */
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/generate">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  if (!cloud()) return Response.json({ state: "idle" });
  const params = new URL(request.url).searchParams;
  const jobId = params.get("job");
  if ((jobId && !uuid(jobId)) || params.has("task") || params.has("gen") || params.has("fallback")) return Response.json({ error: "Invalid job." }, { status: 400 });
  try {
    if (!(await getRun(id, who))) return Response.json({ error: "Not found" }, { status: 404 });
    const job = await generationJob(who, id, jobId ?? undefined);
    if (!job) return jobId ? Response.json({ error: "Not found" }, { status: 404 }) : Response.json({ state: "idle" });
    if (["reserved", "starting", "running"].includes(job.state)) continueJob(who, job.id);
    else after(async () => { try { await expireTemporaryObjects(); } catch (error) { console.error("generation cleanup", error); } });
    return Response.json(await generationReply(job));
  } catch (error) {
    console.error("generation read", error);
    return Response.json({ error: "Generation is unavailable. Try again." }, { status: 503 });
  }
}
