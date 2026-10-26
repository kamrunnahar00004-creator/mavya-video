"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** Set a new password with the session the reset link created. No session (old or used link): ask for a new link. */
export function ResetPasswordForm() {
  const params = useSearchParams();
  const [state, setState] = useState<"checking" | "ready" | "expired">(params.get("expired") ? "expired" : "checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "checking") return;
    void createSupabaseBrowserClient().auth.getUser().then(({ data }) => setState(data.user ? "ready" : "expired"), () => setState("expired"));
  }, [state]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    try {
      const { error: err } = await createSupabaseBrowserClient().auth.updateUser({ password });
      if (err) {
        if (err.status === 401 || err.code === "session_not_found") return setState("expired");
        return setError(err.code === "same_password" ? "Use a different password from your old one." : err.message || "Something went wrong. Try again.");
      }
      // A full load: /auth/continue sends accounts without a plan to Pricing, others into the app.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/auth/continue?next=%2Fstudio");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (state === "checking") return <Loader2 className="mx-auto h-6 w-6 animate-spin text-soft" aria-label="Loading" />;
  if (state === "expired") {
    return (
      <div className="rounded-2xl border border-line bg-panel p-6 sm:p-8">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">This link has expired</h1>
        <p className="mt-1 text-[14px] text-muted">Reset links work once, for one hour.</p>
        <Link href="/?auth=login" className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-accent px-5 py-3 text-[15px] font-semibold text-white hover:bg-accent-hover">
          Get a new link
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5 rounded-2xl border border-line bg-panel p-6 sm:p-8">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Set a new password</h1>
      <label className="mt-2 block">
        <span className="mb-1.5 block text-[12.5px] font-semibold text-muted">New password</span>
        <div className="relative">
          <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required autoFocus className={`${inputClass} pr-11`} placeholder="At least 8 characters" />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-soft hover:text-text">
            {show ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
          </button>
        </div>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-semibold text-muted">Confirm password</span>
        <input type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required className={inputClass} placeholder="Re-enter password" />
      </label>
      {error && <p role="alert" className="text-[13px] font-medium text-red-600">{error}</p>}
      <button type="submit" disabled={loading} className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-[15px] font-semibold text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70">
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        Save password
      </button>
    </form>
  );
}

const inputClass = "w-full rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[15px] text-text outline-none transition-colors focus:border-accent placeholder:text-soft";
