import "server-only";
import { assertProductionConfig } from "@/lib/production-config";
import { workSignal } from "@/lib/server/work-budget";
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
    global: { fetch: (url, options) => fetch(url, { ...options, signal: options?.signal ? AbortSignal.any([options.signal, workSignal(15_000)]) : workSignal(15_000) }) },
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

/**
 * The signed-in user's id, from the session token verified locally (ES256 via the project's JWKS, cached), the same
 * check the proxy uses. No Auth server round trip, so the hot data routes answer ~0.3 s sooner. A revoked session
 * stays valid until its token expires (at most an hour); billing, checkout, account and profile keep getSessionUser.
 */
export const getClaimsUser = cache(async (): Promise<{ id: string } | null> => {
  if (!authEnabled()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return !error && typeof sub === "string" && sub ? { id: sub } : null;
});

/** Service-role client. SERVER ONLY, bypasses RLS for owned records and service-only transactional RPCs. */
let admin: SupabaseClient | null = null;
export function createSupabaseAdminClient(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin env not set. Add SUPABASE_SERVICE_ROLE_KEY.");
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: options?.signal ? AbortSignal.any([options.signal, workSignal(15_000)]) : workSignal(15_000) }) } });
  return admin;
}
