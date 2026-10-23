import { authEnabled, getSessionUser } from "@/lib/supabase/server";
import { beginDeletion, advanceDeletion } from "@/lib/server/account-deletion";
export const maxDuration = 300;
export async function DELETE() {
 if (!authEnabled()) return Response.json({ error: "Accounts are not connected yet." }, { status: 501 });
 const user = await getSessionUser();
 if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
 try {
  await beginDeletion(user.id);
  await advanceDeletion(user.id);
  return Response.json({ ok: true, pending: true }, { status: 202 });
 } catch (error) {
  console.error("account deletion", user.id, error);
  return Response.json({ error: "Couldn't finish deletion. Try again or email hello@mavya.app." }, { status: 503 });
 }
}
