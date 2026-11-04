import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { billingRpc } from "@/lib/server/billing-state";
import { accountClosing } from "@/lib/server/account-state";
import { appendExport, getRun, registerMedia } from "@/lib/server/store";
import { copyObject, deleteObjectStrict, objectInfo, objectStart } from "@/lib/server/r2";
import { type ExportPayload, FAST_MAX_STEPS, callInternal } from "@/lib/server/fast-export";
import { plan } from "../../../render/render.mjs";
import constraints from "../../../render/constraints.json";
type Result = { src: string; seconds: number; at: string };
export type ExportJob = { id: string; user_id: string; run_id: string; media_id: string; overlay_ids: string[]; state: string; created_at: string; result: Result | null; cleaned: boolean; cleanup_cursor: number; progress: number; lease_token: string; payload: { meta: { seconds: number }; [key: string]: unknown } };
export async function exportJob(who: string, run: string, id?: string) {
 let q = createSupabaseAdminClient().from("export_jobs").select("*").eq("user_id", who).eq("run_id", run);
 q = id ? q.eq("id", id) : q.in("state", ["pending", "running"]);
 const { data, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle<ExportJob>();
 if (error) throw error; return data;
}
/**
 * A browser export's upload (payload.upload: a short, size-bound PUT to a staging key) becomes the job's file only
 * after checks: the exact size it promised, an MP4, then a copy to the job's own key, which no browser can write to.
 * Anything else is deleted and the job fails. Returns false when the upload was rejected.
 */
async function promoteUpload(j: ExportJob, upload: { key: string; size: number }): Promise<boolean> {
 const info = await objectInfo(upload.key);
 if (!info) return true;
 const start = info.size === upload.size && info.mime === "video/mp4" ? await objectStart(upload.key, 12) : null;
 const mp4 = !!start && start.length === 12 && String.fromCharCode(...start.slice(4, 8)) === "ftyp";
 if (mp4 && !(await objectInfo(`media/${j.media_id}`))) await copyObject(upload.key, `media/${j.media_id}`, info.etag);
 await deleteObjectStrict(upload.key);
 return mp4;
}

/**
 * The browser's upload failed: end its job now so Export works again at once. Under the job's lease, so it can never
 * race the completion; a file that did arrive is kept and finishes the job instead ("pending").
 */
export async function cancelBrowserExport(who: string, run: string, id: string): Promise<"cancelled" | "pending"> {
 const j = await billingRpc<ExportJob | null>("mavya_claim_export", { p_user: who, p_id: id });
 if (!j) return "pending";
 const db = createSupabaseAdminClient();
 const save = async (patch: Record<string, unknown>) => {
  const { error, data } = await db.from("export_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("lease_token", j.lease_token).select("id");
  if (error || !data?.length) throw error ?? new Error("Export lease changed");
 };
 try {
  const payload = j.payload as ExportPayload;
  if (j.run_id !== run || payload.lane !== "browser" || !["pending", "running"].includes(j.state)) return "pending";
  if ((payload.upload && (await objectInfo(payload.upload.key))) || (await objectInfo(`media/${j.media_id}`))) return "pending";
  await save({ state: "failed" });
  return "cancelled";
 } finally { await save({ lease_token: null, lease_until: null }); }
}

export async function advanceExport(who: string, id: string) {
 if (await accountClosing(who)) return;
 const j = await billingRpc<ExportJob | null>("mavya_claim_export", { p_user: who, p_id: id });
 if (!j) return;
 const db = createSupabaseAdminClient();
 const save = async (patch: Record<string, unknown>) => {
  const { error, data } = await db.from("export_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("lease_token", j.lease_token).select("id");
  if (error || !data?.length) throw error ?? new Error("Export lease changed");
 };
 try {
  const upload = (j.payload as ExportPayload).upload;
  if (upload && ["pending", "running"].includes(j.state) && !(await promoteUpload(j, upload))) { await save({ state: "failed" }); j.state = "failed"; }
  const head = await objectInfo(`media/${j.media_id}`);
  if (head && ["pending", "running"].includes(j.state)) {
   if (head.size <= 0 || head.size > 300 * 1024 * 1024 || head.mime !== "video/mp4") { await save({ state: "failed" }); return; }
   if (await getRun(j.run_id, who)) {
    try { await registerMedia(j.media_id, "video/mp4", head.size, who, null); }
    catch (error) { if ((error as { code?: string }).code !== "23505") throw error; }
    const result = await appendExport(j.run_id, j.media_id, { src: `/api/media/${j.media_id}`, seconds: j.payload.meta.seconds, at: j.created_at }, who);
    await save({ state: result ? "done" : "failed", result, progress: 1 }); j.state = result ? "done" : "failed";
   } else { await deleteObjectStrict(`media/${j.media_id}`); await save({ state: "failed" }); j.state = "failed"; }
  }
  if (["pending", "running"].includes(j.state)) {
   const lane = (j.payload as ExportPayload).lane, laneAt = (j.payload as ExportPayload).laneAt ?? 0;
   if (Date.now() - Date.parse(j.created_at) > 6 * 3600_000) { await save({ state: "failed" }); j.state = "failed"; }
   else if (lane === "browser") {
    // Rendered in the user's browser, which uploads the file to the output link (the check above then finishes the
    // job). No texts were uploaded for a server copy, so a browser that never delivers ends the job as failed.
    if (Date.now() - laneAt > 15 * 60_000) { await save({ state: "failed" }); j.state = "failed"; }
   }
   else if (!lane && process.env.EXPORT_FAST !== "0" && plan((j.payload as ExportPayload).spec).length <= FAST_MAX_STEPS) {
    // Fast lane first (src/lib/server/fast-export.ts): every piece at once on Vercel.
    await save({ state: "running", payload: { ...j.payload, lane: "vercel", laneAt: Date.now() } });
    const started = await callInternal("/api/internal/export-run", { job: j.id }, 15_000).then((r) => r.status === 202).catch(() => false);
    // Not started: straight to the Render worker on the next check.
    if (!started) await save({ payload: { ...j.payload, lane: "vercel-failed" } });
   }
   else if (lane === "vercel" && Date.now() - laneAt < 5 * 60_000) { /* the fast lane is running; its upload finishes the job */ }
   else {
    // The fast lane failed or stalled: the Render worker runs the same job.
    if (lane !== "render") { await save({ payload: { ...j.payload, lane: "render" } }); (j.payload as ExportPayload).lane = "render"; }
    const base = process.env.RENDER_URL?.replace(/\/+$/, "");
    const headers = { authorization: `Bearer ${process.env.RENDER_SECRET}`, "content-type": "application/json" };
    if (!base || !process.env.RENDER_SECRET) throw new Error("Render unavailable");
    const read = await fetch(`${base}/jobs/${j.id}`, { headers, signal: AbortSignal.timeout(55_000), cache: "no-store" });
    if (read.status === 404) {
     const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
     const capability = await health.json().catch(() => null) as { protocol?: number; size?: string } | null;
     // Protocol 3 = durable job ids + 720x1280 exports (Codex V9: protocol 2 covered both 1080 and 720 workers).
     // The worker must also render this app's frame size (protocol 3 covered both 720x1280 and 1080x1920 workers).
     if (!health.ok || capability?.protocol !== 3 || capability.size !== `${constraints.width}x${constraints.height}`) throw new Error("Render worker update required");
     const job = { ...(j.payload as ExportPayload) };
     delete job.lane; delete job.laneAt;
     const sent = await fetch(`${base}/jobs`, { method: "POST", headers, body: JSON.stringify(job), signal: AbortSignal.timeout(55_000) });
     const dispatched = await sent.json().catch(() => null) as { id?: string } | null;
     if (!sent.ok || dispatched?.id !== j.id) throw new Error(`Render dispatch identity ${sent.status}`);
     await save({ state: "running" });
    } else if (read.ok) {
     const remote = await read.json() as { state?: string; progress?: number };
     if (remote.state === "failed") { await save({ state: "failed" }); j.state = "failed"; }
     else await save({ state: "running", progress: typeof remote.progress === "number" && Number.isFinite(remote.progress) ? Math.max(0,Math.min(1,remote.progress)) : 0 });
    } else throw new Error(`Render poll ${read.status}`);
   }
  }
  if (["done", "failed"].includes(j.state) && !j.cleaned) {
   if (upload) await deleteObjectStrict(upload.key);
   // Only export-purpose PNGs from this job's owner are eligible for this cleanup.
   const batch = j.overlay_ids.slice(j.cleanup_cursor, j.cleanup_cursor + 5);
   for (const media of batch) {
    await deleteObjectStrict(`media/${media}`);
    const removed = await db.from("media").delete().eq("id", media).eq("user_id", who);
    if (removed.error) throw removed.error;
   }
   await save({ cleanup_cursor: j.cleanup_cursor + batch.length, cleaned: j.cleanup_cursor + batch.length >= j.overlay_ids.length });
  }
 } finally { await save({ lease_token: null, lease_until: null }); }
}
