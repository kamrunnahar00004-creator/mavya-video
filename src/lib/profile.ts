/** The signed-in person's profile. `email` comes from sign-in (read-only); `avatar` is an uploaded /api/media URL. */
export type Profile = { email: string; firstName: string; lastName: string; avatar: string };

export const NO_PROFILE: Profile = { email: "", firstName: "", lastName: "", avatar: "" };

/** Fired on window after the profile is saved, so the sidebar chip updates without a reload. */
export const PROFILE_EVENT = "mavya:profile";

export const displayName = (p: Profile) => [p.firstName, p.lastName].filter(Boolean).join(" ") || "Your profile";
export const initials = (p: Profile) => ((p.firstName[0] ?? "") + (p.lastName[0] ?? "")).toUpperCase() || "M";
