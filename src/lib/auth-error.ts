/** Prefer stable Supabase codes; retain exact legacy messages for older Auth responses. */
export function authError(error: unknown, signup: boolean): { message: string; login: boolean } {
  const e = error as { code?: string; message?: string } | null;
  const message = typeof e?.message === "string" ? e.message : "";
  if (signup && (e?.code === "user_already_exists" || (!e?.code && /^(User already registered|User already exists)\.?$/i.test(message)))) {
    return { message: "You already have an account. Log in instead.", login: true };
  }
  if (!signup && (e?.code === "invalid_credentials" || (!e?.code && /^Invalid login credentials\.?$/i.test(message)))) {
    return { message: "Wrong email or password.", login: false };
  }
  return { message: message || "Something went wrong. Try again.", login: false };
}
