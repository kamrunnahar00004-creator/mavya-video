import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { billingRpc } from "@/lib/server/billing-state";
import { newUpload } from "@/lib/server/store";
import { copyObject, deleteObjectStrict, objectInfo, signedPut } from "@/lib/server/r2";
type Reservation = { media_id: string; mime: string; staging_key: string; declared_size: number; state: string; lease_token: string };
export async function startUpload(who: string, mime: string, size: number) {
 const { mediaId } = newUpload(mime);
 const key = `tmp/uploads/${mediaId}`;
 const { error } = await createSupabaseAdminClient().from("upload_reservations").insert({ media_id: mediaId, user_id: who, mime, declared_size: size, staging_key: key });
 if (error) throw error;
 return { mediaId, url: await signedPut(key, mime, 900, size) };
}
export async function finishUpload(who: string, id: string, mime: string, name: string | null) {
 const r = await billingRpc<Reservation | null>("mavya_claim_upload", { p_user: who, p_media: id });
 if (!r || r.mime !== mime) throw new Error("Upload expired or unavailable. Upload it again.");
 if (r.state !== "done") {
  const head = await objectInfo(r.staging_key);
  if (!head || !head.etag || head.size !== r.declared_size || head.size > 300 * 1024 * 1024 || head.mime !== mime) throw new Error("Upload size or type did not match.");
  await copyObject(r.staging_key, `media/${id}`, head.etag);
  if (!(await billingRpc<boolean>("mavya_finish_upload", { p_user: who, p_media: id, p_token: r.lease_token, p_name: name }))) throw new Error("Upload expired. Upload it again.");
 }
 return { mediaId: id, mime };
}
export async function expireUploads() {
 const db = createSupabaseAdminClient();
 const { data, error } = await db.from("upload_reservations").select("media_id,staging_key,state").lt("expires_at", new Date().toISOString()).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).limit(5);
 if (error) throw error;
 for (const r of data ?? []) {
  await deleteObjectStrict(r.staging_key);
  if (r.state !== "done") await deleteObjectStrict(`media/${r.media_id}`);
  const removed = await db.from("upload_reservations").delete().eq("media_id", r.media_id);
  if (removed.error) throw removed.error;
 }
 return data?.length ?? 0;
}
