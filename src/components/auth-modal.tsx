"use client";
import { safeNext } from "@/lib/auth-next";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/*
 * Sign in / sign up, the same popup as the Etsy Mavya app: Google, or email and password, login and signup in one
 * overlay (no forgot password until email sending is set up). It opens over the marketing pages from `?auth=login` or `?auth=signup` (the header buttons, and the
 * proxy sends signed-out visitors here with `next` = where they were going). Access control is server-side; this
 * is only the UI.
 */
type Mode = "login" | "signup";
const noop = () => () => undefined;


/** Renders the popup when the URL asks for it; closing removes the parameters. */
export function AuthModalHost() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const auth = params.get("auth");
  const close = useCallback(() => router.replace(pathname, { scroll: false }), [router, pathname]);
  // The popup portals into <body>, so it renders in the browser only.
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);
  if (!inBrowser || (auth !== "login" && auth !== "signup")) return null;
  return <AuthModal key={auth} initialMode={auth} next={safeNext(params.get("next"))} error={params.get("error") ? "Sign-in didn't finish. Try again." : null} onClose={close} />;
}

function AuthModal({ initialMode, next, error: initialError, onClose }: { initialMode: Mode; next: string; error: string | null; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const isSignup = mode === "signup";
  const callback = (to: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(to)}`;

  useEffect(() => {
    emailRef.current?.focus();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [loading, onClose]);

  function switchMode(to: Mode) {
    setMode(to);
    setError(null);
    setNotice(null);
  }

  async function handleGoogle() {
    setError(null);
    setLoading(true);
    try {
      const { error: e } = await createSupabaseBrowserClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback(next) } });
      if (e) throw e;
      // The browser goes to Google from here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) return setError("Enter your email and password.");
    if (isSignup) {
      if (password.length < 8) return setError("Password must be at least 8 characters.");
      if (password !== confirm) return setError("Passwords do not match.");
    }
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (isSignup) {
        const { data, error: e } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: callback(next), data: name.trim() ? { full_name: name.trim() } : undefined },
        });
        if (e) throw e;
        // With email confirmation on there is no session yet.
        if (!data.session) {
          setNotice("Check your email to confirm your account, then log in.");
          setLoading(false);
          return;
        }
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw e;
      }
      // A full page load: the router may hold a prefetched "signed out, go to sign-up" answer for `next`.
      // /auth/continue is a route handler (no plan: Plans; else `next`), so this must be a real page load.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/auth/continue?next=${encodeURIComponent(next)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  // Portal to <body>: the sticky header's backdrop blur would otherwise contain the fixed overlay.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isSignup ? "Create your account" : "Log in"}
      className="landing-theme fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,13,11,0.55)] px-4 py-8 backdrop-blur-sm"
      onClick={() => !loading && onClose()}
    >
      <div className="relative max-h-full w-full max-w-[460px] overflow-y-auto rounded-2xl border border-line bg-panel p-6 shadow-[0_24px_64px_-16px_rgba(21,18,31,0.45)] sm:p-8" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-soft hover:bg-raised hover:text-text"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <h2 className="text-[24px] font-semibold tracking-[-0.02em]">{isSignup ? "Create your account" : "Welcome back"}</h2>
        <p className="mt-1 text-[14px] text-muted">{isSignup ? "Make your first hook + demo video." : "Log in to continue."}</p>

        <button
          type="button"
          onClick={() => void handleGoogle()}
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-panel px-4 py-3 text-[14.5px] font-semibold transition-colors hover:bg-raised disabled:opacity-60"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-soft">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {isSignup && (
            <Field label="Name (optional)">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} className={inputClass} placeholder="Your name" />
            </Field>
          )}
          <Field label="Email">
            <input ref={emailRef} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className={inputClass} placeholder="you@example.com" />
          </Field>
          <Field label="Password">
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? "new-password" : "current-password"}
                required
                className={`${inputClass} pr-11`}
                placeholder={isSignup ? "At least 8 characters" : "••••••••"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-soft hover:text-text"
              >
                {showPassword ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
              </button>
            </div>
          </Field>
          {isSignup && (
            <Field label="Confirm password">
              <input type={showPassword ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required className={inputClass} placeholder="Re-enter password" />
            </Field>
          )}

          {error && <p role="alert" className="text-[13px] font-medium text-red-600">{error}</p>}
          {notice && <p role="status" className="text-[13px] font-medium">{notice}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-[15px] font-semibold text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="mt-5 text-center text-[13.5px] text-muted">
          {isSignup ? "Already have an account? " : "Don't have an account? "}
          <button type="button" onClick={() => switchMode(isSignup ? "login" : "signup")} className="font-semibold text-accent hover:underline">
            {isSignup ? "Log in" : "Sign up"}
          </button>
        </p>
        <p className="mt-4 text-center text-[12.5px] leading-relaxed text-soft">
          By continuing, you agree to Mavya&apos;s{" "}
          <a href="/terms" target="_blank" rel="noopener" className="font-medium text-muted underline underline-offset-2 hover:text-text">Terms of Service</a> and{" "}
          <a href="/privacy" target="_blank" rel="noopener" className="font-medium text-muted underline underline-offset-2 hover:text-text">Privacy Policy</a>.
        </p>
      </div>
    </div>,
    document.body,
  );
}

const inputClass = "w-full rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[15px] text-text outline-none transition-colors focus:border-accent placeholder:text-soft";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
