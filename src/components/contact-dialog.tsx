"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/** Business: a message box that lands in the founder's inbox (POST /api/contact). */
export function ContactDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);

  if (!open) return null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, message, company }) });
      if (res.ok) {
        setState("sent");
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Couldn't send. Try again.");
    } catch {
      setError("Couldn't send. Check your connection and try again.");
    }
    setState("idle");
  };

  const field = "w-full rounded-lg border border-line-strong bg-panel px-3 py-2.5 text-[15px] text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15121f]/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="contact-title" className="relative w-full max-w-[460px] rounded-2xl bg-panel p-6 text-left text-text shadow-[0_24px_64px_-16px_rgba(21,18,31,0.45)] sm:p-7">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-soft hover:bg-raised hover:text-text">
          <X className="h-5 w-5" />
        </button>
        {state === "sent" ? (
          <div className="py-4">
            <h2 id="contact-title" className="text-[22px] font-semibold tracking-[-0.02em]">Sent</h2>
            <p className="mt-2 text-[15px] text-muted">We&apos;ll reply to {email}.</p>
            <button type="button" onClick={onClose} className="btn-primary mt-6 px-5 py-2.5 text-[15px]">Done</button>
          </div>
        ) : (
          <form onSubmit={send}>
            <h2 id="contact-title" className="text-[22px] font-semibold tracking-[-0.02em]">Talk to us about Business</h2>
            <label className="mt-5 block text-[13px] font-semibold" htmlFor="contact-email">Email</label>
            <input ref={first} id="contact-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${field} mt-1.5`} />
            <label className="mt-4 block text-[13px] font-semibold" htmlFor="contact-message">Message</label>
            <textarea id="contact-message" required rows={5} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your website and what you want to grow" className={`${field} mt-1.5 resize-none`} />
            <input type="text" tabIndex={-1} autoComplete="off" aria-hidden value={company} onChange={(e) => setCompany(e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" />
            {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-600">{error}</p>}
            <button type="submit" disabled={state === "sending"} className="btn-primary mt-5 w-full px-5 py-3 text-[15px] disabled:opacity-60">
              {state === "sending" ? "Sending..." : "Send"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
