"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client (public anon key; row level security is the real gate). Used for Google sign-in and sign-out. */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase env not set. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  return createBrowserClient(url, anonKey);
}
