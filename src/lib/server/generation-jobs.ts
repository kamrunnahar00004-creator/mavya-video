import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { adminUser } from "@/lib/server/usage";
import { cloud, getRun, mediaAccess, registerMedia } from "@/lib/server/store";
import { putObject } from "@/lib/server/r2";
import { HookStartUncertain, checkHook, startHook } from "@/lib/server/hookgen";
import { generationPatch } from "@/lib/generation-edit";
import type { Reference, Run } from "@/lib/types";

export type GenerationJob = {
  id: string; user_id: string; run_id: string; state: "reserved" | "starting" | "running" | "done" | "failed" | "uncertain";
  input: Run; reference: Reference | null; note: string | null; fallback_used: boolean;
  task_id: string | null; fallback_task_id: string | null; lease_token: string; created_at: string;
  result: NonNullable<Run["hook"]["generated"]> | null; error: string | null;
};
const db = () => createSupabaseAdminClient();
export async function reserveGeneration(who: string, run: string, key: string, note?: string) {
  if (!cloud()) throw new Error("Generation storage is unavailable");
  const { data, error } = await db().rpc("mavya_reserve_generation", { p_user: who, p_run: run, p_key: key, p_note: note ?? null, p_admin: await adminUser(who) });
  if (error || !data) throw error ?? new Error("Reservation unavailable");
  return data as { job?: GenerationJob; error?: string; allowance?: { limit: number } };
}
export async function generationJob(who: string, run: string, id?: string): Promise<GenerationJob | null> {
  let query = db().from("generations").select("*").eq("user_id", who).eq("run_id", run);
  query = id ? query.eq("id", id) : query.in("state", ["reserved", "starting", "running", "uncertain"]);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle<GenerationJob>();
  if (error) throw error;
  return data;
}
async function transition(job: GenerationJob, action: string, value?: string) {
  const { data, error } = await db().rpc("mavya_generation_transition", { p_user: job.user_id, p_job: job.id, p_token: job.lease_token, p_action: action, p_value: value ?? null });
  if (error || data !== true) throw error ?? new Error("Generation lease changed");
}

/** Work is claimed in Postgres, not in browser state or a per-instance mutex. */
export async function advanceGeneration(who: string, id: string): Promise<void> {
  const claimed = await db().rpc("mavya_claim_generation", { p_user: who, p_job: id });
  if (claimed.error) throw claimed.error;
  const job = claimed.data as GenerationJob | null;
  if (!job) return;
  if (job.state === "starting") {
    let task: string;
    try {
      task = await startHook(job.input, job.reference, who, job.note ?? undefined, job.fallback_used);
    } catch (error) {
      console.error("generation start", job.id, error);
      if (error instanceof HookStartUncertain) await transition(job, "uncertain");
      else await transition(job, job.fallback_used ? "failed" : "fallback");
      return;
    }
    // If storing an accepted task fails, leave starting leased. Recovery marks uncertainty, never respends.
    await transition(job, "started", task);
    return;
  }
  try {
    const taskId = job.fallback_used ? job.fallback_task_id : job.task_id;
    if (!taskId) throw new Error("Missing provider task");
    const task = await checkHook(taskId);
    if (task.state === "failed") return transition(job, job.fallback_used ? "failed" : "fallback");
    if (task.state === "running") return transition(job, "release");
    // Deterministic output key: retrying finalization cannot create another file or history entry.
    const mediaId = `${job.id}.mp4`;
    if (!(await mediaAccess(mediaId, who))) {
      await putObject(`media/${mediaId}`, task.video, "video/mp4");
      try { await registerMedia(mediaId, "video/mp4", task.video.length, who, null); }
      catch (error) { if ((error as { code?: string }).code !== "23505") throw error; }
    }
    const generated = { src: `/api/media/${mediaId}`, seconds: task.seconds, at: job.created_at, ...(job.note ? { note: job.note } : {}) };
    const suggested = job.input.hook.source === "describe" ? "" : (job.input.script?.refId === (job.reference?.id ?? null) ? job.input.script?.hookText : "") || job.reference?.recipe?.onScreenText?.[0]?.text || job.reference?.title || "";
    for (let i = 0; i < 5; i++) {
      const run = await getRun(job.run_id, who);
      const patch = run ? generationPatch(run, job.input, generated, suggested) : {};
      const completed = await db().rpc("mavya_complete_generation", { p_user: who, p_job: job.id, p_token: job.lease_token, p_updated: run?.updatedAt ?? null, p_patch: patch, p_result: generated });
      if (completed.error) throw completed.error;
      if (completed.data && !completed.data.retry) return;
    }
    throw new Error("Run changed while completing generation");
  } catch (error) {
    console.error("generation poll", job.id, error);
    // A download/storage/DB failure is not a failed provider generation and never triggers a refund/fallback.
    await transition(job, "release");
  }
}

export async function generationReply(job: GenerationJob) {
  if (job.state === "done") return { job: job.id, state: "done", generated: job.result, run: await getRun(job.run_id, job.user_id) };
  if (job.state === "failed" || job.state === "uncertain") return { job: job.id, state: "failed", error: job.error ?? "The generation failed. Try again." };
  return { job: job.id, state: "running", progress: 0 };
}
