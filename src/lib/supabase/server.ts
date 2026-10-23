import "server-only";
import { assertProductionConfig } from "@/lib/production-config";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Accounts are on once the Supabase keys are set; without them the app runs locally as before (no sign-in). */
export const authEnabled = () => { assertProductionConfig(); return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY); };

/** Server Supabase client bound to the request cookies: reads the signed-in user, queries under RLS. */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase env not set. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Read-only in Server Components; the proxy writes refreshed session cookies.
        }
      },
    },
  });
}

/** The signed-in user, checked with the Auth server (for API authorization and writes). */
export const getSessionUser = cache(async () => {
  if (!authEnabled()) return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Service-role client. SERVER ONLY, bypasses RLS for owned records and service-only transactional RPCs. */
let admin: SupabaseClient | null = null;
export function createSupabaseAdminClient(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin env not set. Add SUPABASE_SERVICE_ROLE_KEY.");
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
