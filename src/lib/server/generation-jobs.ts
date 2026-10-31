import "server-only";
import { accountClosing } from "@/lib/server/account-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { adminUser } from "@/lib/server/usage";
import { cloud, getRun, mediaAccess, registerMedia } from "@/lib/server/store";
import { copyObject, objectInfo, putObject } from "@/lib/server/r2";
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
/**
 * Failed generations are refunded, but their preparation (Gemini outfit and frame) is already paid. A cap on refunded
 * attempts per day stops a failing hook being retried without end (Codex V6). Successful hooks are not affected.
 */
const FAILED_ATTEMPTS_PER_DAY = 10;
export async function reserveGeneration(who: string, run: string, key: string, note?: string) {
  if (!cloud()) throw new Error("Generation storage is unavailable");
  const admin = await adminUser(who);
  if (!admin) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const failed = await db().from("generations").select("id", { count: "exact", head: true }).eq("user_id", who).not("refunded_at", "is", null).gte("refunded_at", since);
    if (failed.error) throw failed.error;
    if ((failed.count ?? 0) >= FAILED_ATTEMPTS_PER_DAY) {
      // Admission limits new work, not a replay of work already reserved for this owner/run.
      const replay = await db().from("generations").select("*").eq("user_id", who).eq("run_id", run).eq("request_key", key).maybeSingle<GenerationJob>();
      if (replay.error) throw replay.error;
      const existing = replay.data ?? await generationJob(who, run);
      if (existing) return { job: existing };
      return { error: "attempts" } as { job?: GenerationJob; error?: string; allowance?: { limit: number } };
    }
  }
  const { data, error } = await db().rpc("mavya_reserve_generation", { p_user: who, p_run: run, p_key: key, p_note: note ?? null, p_admin: admin });
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

/**
 * A hook clip holds only the viral hook's motion and the character (the product and its text go on top later), so the
 * same library hook + built-in character + same cut can be served from an earlier generation: no Gemini, no fal. The
 * seller's quota counts it like any hook. Uploaded hooks, photos and described characters are never shared.
 * The file is copied, so each seller owns theirs (media access and account deletion stay per owner).
 */
const REUSE_TASK = /^cache\|([0-9a-f-]{36})$/i;
const REUSE_POOL = 5;
/** The usual Generate screen runs this long from the click, then the clip appears. */
const REUSE_SHOW_MS = 3500;
type ReuseRow = { id: string; result: GenerationJob["result"]; start: unknown; end: unknown };

/** Copies a matching earlier clip to this job's file and returns its task id; null = generate normally. */
async function reuseHook(job: GenerationJob, who: string): Promise<string | null> {
  try {
    const { hook, sourceRefId } = job.input;
    // Regenerate (a note, or a hook already in the video) always makes a new one.
    if (job.fallback_used || job.note?.trim() || hook.generated || hook.face?.kind !== "character" || !sourceRefId) return null;
    const curated = await db().from("library").select("id").eq("id", sourceRefId).eq("owner", "curated").maybeSingle();
    if (curated.error) throw curated.error;
    if (!curated.data) return null;
    const { data, error } = await db().from("generations").select("id, result, start:input->hook->start, end:input->hook->end")
      .eq("state", "done").eq("input->>sourceRefId", sourceRefId).eq("input->hook->face->>kind", "character").eq("input->hook->face->>id", hook.face.id)
      .is("note", null).order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    const same = ((data ?? []) as unknown as ReuseRow[]).filter((row) => (row.start ?? null) === (hook.start ?? null) && (row.end ?? null) === (hook.end ?? null)).slice(0, REUSE_POOL);
    // Newest few, in random order: when a combination has several clips, sellers do not all get the same one.
    for (const row of same.map((x) => ({ x, order: Math.random() })).sort((a, b) => a.order - b.order).map((y) => y.x)) {
      const file = row.result?.src.match(/^\/api\/media\/([0-9a-f-]{36}\.mp4)$/)?.[1];
      const info = file ? await objectInfo(`media/${file}`) : null;
      if (!file || !info) continue;
      const mediaId = `${job.id}.mp4`;
      if (await accountClosing(who)) return null;
      await copyObject(`media/${file}`, `media/${mediaId}`, info.etag);
      try { await registerMedia(mediaId, "video/mp4", info.size, who, null); }
      catch (error) { if ((error as { code?: string }).code !== "23505") throw error; }
      return `cache|${row.id}`;
    }
    return null;
  } catch (error) {
    // Reuse only saves money: anything wrong here falls back to a real generation.
    console.error("generation reuse", job.id, error);
    return null;
  }
}

/** The reused clip's length, once the Generate screen has had its moment. */
async function reusedSeconds(job: GenerationJob, from: string): Promise<number> {
  const wait = Date.parse(job.created_at) + REUSE_SHOW_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  const { data, error } = await db().from("generations").select("result").eq("id", from).maybeSingle<{ result: GenerationJob["result"] }>();
  if (error) throw error;
  if (!data?.result) throw new Error("Reused hook is gone");
  return data.result.seconds;
}

/** Work is claimed in Postgres, not in browser state or a per-instance mutex. */
export async function advanceGeneration(who: string, id: string): Promise<void> {
  if (await accountClosing(who)) return;
  const claimed = await db().rpc("mavya_claim_generation", { p_user: who, p_job: id });
  if (claimed.error) throw claimed.error;
  const job = claimed.data as GenerationJob | null;
  if (!job) return;
  if (job.state === "starting") {
    const reused = await reuseHook(job, who);
    if (reused) {
      await transition(job, "started", reused);
      return advanceGeneration(who, job.id);
    }
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
    // Deterministic output key: retrying finalization cannot create another file or history entry.
    const mediaId = `${job.id}.mp4`;
    const reused = taskId.match(REUSE_TASK);
    let seconds: number;
    if (reused) {
      // The file was copied and registered before the task was stored.
      seconds = await reusedSeconds(job, reused[1]);
      if (await accountClosing(who)) return;
    } else {
      const task = await checkHook(taskId);
      if (task.state === "failed") return transition(job, job.fallback_used ? "failed" : "fallback");
      if (task.state === "running") return transition(job, "release");
      seconds = task.seconds;
      if (await accountClosing(who)) return;
      if (!(await mediaAccess(mediaId, who))) {
        await putObject(`media/${mediaId}`, task.video, "video/mp4");
        try { await registerMedia(mediaId, "video/mp4", task.video.length, who, null); }
        catch (error) { if ((error as { code?: string }).code !== "23505") throw error; }
      }
    }
    const generated = { src: `/api/media/${mediaId}`, seconds, at: job.created_at, ...(job.note ? { note: job.note } : {}) };
    // The stolen video's own words are placeholders: the product's hook line (written by the same Generate click,
    // usually done before the clip) replaces them; text the seller typed stays.
    const stolen = [job.reference?.recipe?.onScreenText?.[0]?.text, job.reference?.title].filter((x): x is string => Boolean(x));
    for (let i = 0; i < 5; i++) {
      const run = await getRun(job.run_id, who);
      const script = run?.script?.refId === (job.reference?.id ?? null) ? run?.script : job.input.script?.refId === (job.reference?.id ?? null) ? job.input.script : null;
      const suggested = job.input.hook.source === "describe" ? "" : script?.hookText || stolen[0] || "";
      const patch = run ? generationPatch(run, job.input, generated, suggested, stolen) : {};
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
