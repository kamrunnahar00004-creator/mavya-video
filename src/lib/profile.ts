/** The signed-in person's profile. `email` comes from sign-in (read-only); `avatar` is an uploaded /api/media URL. */
export type Profile = { email: string; firstName: string; lastName: string; avatar: string };

export const NO_PROFILE: Profile = { email: "", firstName: "", lastName: "", avatar: "" };

/** Fired on window after the profile is saved, so the sidebar chip updates without a reload. */
export const PROFILE_EVENT = "mavya:profile";

/** Accounts are on once the Supabase keys are set (read at build time, same as the server). */
export const AUTH_ENABLED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** Sign out in the browser, then go to the landing page. */
export async function signOut() {
  window.dispatchEvent(new CustomEvent("mavya:navigate", { detail: "/" }));
  if (AUTH_ENABLED) {
    const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
    await createSupabaseBrowserClient().auth.signOut().catch(() => undefined);
  }
  // A full reload, so nothing from the signed-in session stays in memory.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/";
}

export const displayName = (p: Profile) => [p.firstName, p.lastName].filter(Boolean).join(" ") || "Your profile";
export const initials = (p: Profile) => ((p.firstName[0] ?? "") + (p.lastName[0] ?? "")).toUpperCase() || "M";
