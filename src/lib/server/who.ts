import "server-only";
import { authEnabled, getSessionUser } from "@/lib/supabase/server";

/** The signed-in user's id for the store ("local" when accounts are off), or null when signed out. */
export async function currentUser(): Promise<string | null> {
  if (!authEnabled()) return "local";
  return (await getSessionUser())?.id ?? null;
}

export const signInFirst = () => Response.json({ error: "Sign in first." }, { status: 401 });
