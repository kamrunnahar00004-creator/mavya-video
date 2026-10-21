"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { MavyaMark } from "@/components/marketing-chrome";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** Sign in or sign up (the same thing): Continue with Google, then back to where they were going. */
export function LoginView() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "Sign-in didn't finish. Try again." : null);

  const google = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = params.get("next") ?? "/studio";
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: e } = await createSupabaseBrowserClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (e) throw e;
    } catch {
      setError("Couldn't start Google sign-in. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="landing-theme flex min-h-full flex-col items-center justify-center bg-bg px-5 py-16">
      <Link href="/" className="flex items-center gap-2.5">
        <MavyaMark className="h-10 w-10" />
        <span className="text-[22px] font-bold tracking-tight">Mavya</span>
      </Link>
      <div className="mt-8 w-full max-w-[400px] rounded-2xl border border-line bg-panel p-8 text-center shadow-[0_24px_48px_-24px_rgba(21,18,31,0.25)]">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Welcome to Mavya</h1>
        <p className="mt-1.5 text-[14.5px] text-muted">Sign in or create your account</p>
        <button
          type="button"
          onClick={() => void google()}
          disabled={busy}
          className="mt-7 flex w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-line-strong bg-panel px-4 py-3 text-[15px] font-semibold hover:border-ink disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleIcon />}
          Continue with Google
        </button>
        {error && <p role="alert" className="mt-4 text-[13.5px] font-semibold text-red-600">{error}</p>}
      </div>
      <p className="mt-6 max-w-[400px] text-center text-[12.5px] text-soft">
        By continuing you agree to the <Link href="/terms" className="underline hover:text-text">Terms</Link> and <Link href="/privacy" className="underline hover:text-text">Privacy Policy</Link>.
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
