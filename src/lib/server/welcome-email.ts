import "server-only";

/**
 * Welcome email (founder 2026-11-26, for paid ads): most ad signups happen on a phone, inside Instagram, but Mavya is
 * edited on a computer. One email right after signup puts the link in their inbox so they can open it there later.
 * Sent from /auth/continue after the redirect (never slows signup). Resend's Idempotency-Key (24 h) keeps a second
 * sign-in in the new-account window from sending it twice, so no table is needed. Off without RESEND_API_KEY.
 */

export const WELCOME_LINK = "https://mavya.app/studio";

export type WelcomeUser = { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

/** First name from the sign-up (Google gives a name), letters only, or "" when unknown. */
export function firstName(meta: Record<string, unknown> | null | undefined): string {
  const raw = [meta?.first_name, meta?.given_name, meta?.full_name, meta?.name].find((v) => typeof v === "string" && v.trim());
  const word = typeof raw === "string" ? raw.trim().split(/\s+/)[0] : "";
  return /^[\p{L}'-]{1,30}$/u.test(word) ? word : "";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The email itself (founder's copy, 2026-11-26): subject, plain text and HTML. No em or en dashes (founder rule). */
export function welcomeEmail(name: string): { subject: string; text: string; html: string } {
  const hi = `Hey ${name || "there"},`;
  const subject = "Welcome to Mavya 🎬";
  const text = [
    hi,
    "",
    "Thanks for joining Mavya. Let's make your first reel.",
    "",
    "Open Mavya on your laptop or desktop, pick a hook, add your app demo, and export.",
    "",
    `Create your first reel: ${WELCOME_LINK}`,
    "",
    "Need a hand? Just reply.",
    "",
    "Rooting for you,",
    "The Mavya team",
  ].join("\n");
  // Every margin set inline (Gmail drops <style> and resets <p>): 16 px between lines, 28 px around the button.
  const p = 'style="margin:0 0 16px"';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:480px">
<p ${p}>${esc(hi)}</p>
<p ${p}>Thanks for joining Mavya. Let's make your first reel.</p>
<p style="margin:0">Open Mavya on your laptop or desktop, pick a hook, add your app demo, and export.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0"><tr><td style="border-radius:8px;background:#111"><a href="${WELCOME_LINK}" style="display:inline-block;color:#fff;text-decoration:none;padding:12px 22px;font-weight:600;font-size:15px">Create your first reel &rarr;</a></td></tr></table>
<p ${p}>Need a hand? Just reply.</p>
<p style="margin:0">Rooting for you,<br>The Mavya team</p>
</div>`;
  return { subject, text, html };
}

/**
 * Sends the welcome email once per account, with one retry on a timeout, 429 or 5xx (Codex 2026-11-26). Never throws:
 * a failure is logged by status only (no provider text, which can hold the address); signup is not affected.
 */
export async function sendWelcome(user: WelcomeUser, env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch, retryMs = 3000): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  const to = user.email?.trim() ?? "";
  if (!key || !EMAIL.test(to) || to.length > 254) return false;
  const mail = welcomeEmail(firstName(user.user_metadata));
  const body = JSON.stringify({
    from: env.WELCOME_FROM || "Mavya <hello@mavya.app>",
    to: [to],
    reply_to: "hello@mavya.app",
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, retryMs));
    let status = 0;
    try {
      const res = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        // Same key on the retry: Resend sends it at most once.
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": `welcome/${user.id}` },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return true;
      status = res.status;
    } catch {
      status = 0;
    }
    console.error("welcome email failed", status || "network");
    if (status && status !== 429 && status < 500) return false;
  }
  return false;
}
