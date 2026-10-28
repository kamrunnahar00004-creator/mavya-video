import "server-only";
import { authEnabled, getClaimsUser } from "@/lib/supabase/server";
import { accountClosing } from "@/lib/server/account-state";

/** The signed-in user's id for the store ("local" when accounts are off), or null when signed out. */
export async function currentUser(): Promise<string | null> {
  if (!authEnabled()) return "local";
  const user = await getClaimsUser();
  return user && !(await accountClosing(user.id)) ? user.id : null;
}

export const signInFirst = () => Response.json({ error: "Sign in first." }, { status: 401 });
