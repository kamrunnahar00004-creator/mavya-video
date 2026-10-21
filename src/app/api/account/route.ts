import { authEnabled, createSupabaseAdminClient, getSessionUser } from "@/lib/supabase/server";

/**
 * Delete the signed-in account. Removing the auth user also removes their `profiles` row (on delete cascade).
 * Their videos and files move to the database and storage with ownership later; until then they stay in the local
 * store.
 */
export async function DELETE() {
  if (!authEnabled()) return Response.json({ error: "Accounts are not connected yet." }, { status: 501 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(user.id);
  if (error) return Response.json({ error: "Couldn't delete the account. Email hello@mavya.app." }, { status: 500 });
  return Response.json({ ok: true });
}
