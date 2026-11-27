/**
 * Checkout recovery emails (founder 2026-11-27, copy written with the founder): three short notes from the founder to
 * someone who opened checkout and left without starting the trial. Sent about 1 hour, 1 day and 3 days after the
 * checkout expired (src/lib/server/checkout-recovery.ts), each at most once, stopped by a trial or an unsubscribe.
 * No em or en dashes (founder rule).
 */

export const SITE = "https://mavya.app";
/** Hours after the checkout expired that each email is due; each stays due for a day, then it is skipped. */
export const STEP_HOURS = [0, 24, 72] as const;
export const DUE_WINDOW_H = 24;

/** The step (0, 1, 2) due at `now` for a checkout that expired at `expiresAt` (ms), or null. */
export function dueStep(expiresAt: number, now: number): number | null {
  const h = (now - expiresAt) / 3600_000;
  for (let i = STEP_HOURS.length - 1; i >= 0; i--) if (h >= STEP_HOURS[i] && h < STEP_HOURS[i] + DUE_WINDOW_H) return i;
  return null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const p = (t: string, m = "0 0 18px") => `<p style="margin:${m}">${t}</p>`;
const button = (link: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px"><tr><td style="border-radius:8px;background:#111"><a href="${esc(link)}" style="display:inline-block;color:#fff;text-decoration:none;padding:12px 22px;font-weight:600;font-size:15px">Start my 3-day free trial &rarr;</a></td></tr></table>`;
const RISK = `<p style="margin:0 0 28px;font-size:13.5px;color:#555">Free for 3 days. Cancel anytime.</p>`;
const SIGN = `<p style="margin:0 0 28px">Farhan<br>Founder, Mavya</p>`;
const footer = (stop: string) => `<p style="margin:0;font-size:12px;color:#888">Don't want these emails? <a href="${esc(stop)}" style="color:#888">Unsubscribe</a></p>`;
const wrap = (body: string) => `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:520px">${body}</div>`;

type Line = string | { gif: true };
const STEPS: { subject: string; lines: Line[]; ask: string }[] = [
  {
    subject: "you were one click away",
    lines: ["Hey there,", "You were one click away from your first viral reel.", "Did something stop you?", "If anything was unclear, just reply. I read every email.", "If you just got pulled away, your trial is still waiting."],
    ask: "",
  },
  {
    subject: "i copied a 5M-view reel for my app",
    lines: [
      "Hey there,", "My app had 0 users for 6 months.", "Then I tried something different.",
      "I picked a reel with millions of views, recreated its hook with an AI face, and made a demo for my app using the same style.",
      "The result? 20.2k views and 582 users.", { gif: true }, "That's why I built Mavya.",
      "Pick a reel from our viral library. Mavya recreates the hook with an AI character and rewrites the viral script for your app.",
      "Your reel is ready in minutes. You never film your face.", "And the best part? 10 hooks × 10 demos = 100 reels.", "More posts. More views. More users.",
    ],
    ask: "Trying to get users for your app? Make your first reel free.",
  },
  {
    subject: "not ready for users yet?",
    lines: ["Hey there,", "This is my last email about this.", "If you're not ready for users yet, no problem.", "When you are, Mavya is here.", "Pick a viral reel. Make it about your app. Post it.", "10 hooks. 10 demos. 100 shots at going viral."],
    ask: "Ready now? Make your first reel free.",
  },
];

/** Email `step` (0 to 2): subject, HTML and plain text. `link` reopens their checkout; `stop` unsubscribes. */
export function recoveryEmail(step: number, link: string, stop: string): { subject: string; html: string; text: string } {
  const s = STEPS[step];
  const gif = `<a href="${esc(link)}"><img src="${SITE}/email/before-after.gif" width="420" alt="A viral hook and the same hook made with Mavya" style="display:block;width:100%;max-width:420px;height:auto;border-radius:8px;margin:0 0 18px"></a>`;
  const body = s.lines.map((l) => (typeof l === "string" ? p(esc(l)) : gif)).join("") + (s.ask ? p(esc(s.ask)) : "");
  const html = wrap(body + button(link) + RISK + SIGN + footer(stop));
  const text = [...s.lines.filter((l): l is string => typeof l === "string"), ...(s.ask ? [s.ask] : []), `Start my 3-day free trial: ${link}`, "Free for 3 days. Cancel anytime.", "", "Farhan", "Founder, Mavya", "", `Unsubscribe: ${stop}`].join("\n\n");
  return { subject: s.subject, html, text };
}
