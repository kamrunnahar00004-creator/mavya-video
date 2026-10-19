import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Business inquiries from the pricing page. Every message is kept in .data/inquiries.jsonl; when RESEND_API_KEY and
 * CONTACT_TO are set it is also emailed there (reply goes straight to the sender). CONTACT_FROM is a sender on a
 * domain verified in Resend; without one, Resend's test sender only delivers to the account owner's address.
 */
const DATA_DIR = path.join(process.cwd(), ".data");
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
const WINDOW_MS = 60 * 60 * 1000;
const PER_WINDOW = 5;
const recent = new Map<string, number[]>();

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; message?: unknown; company?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!EMAIL.test(email) || email.length > 254) return Response.json({ error: "Enter a valid email." }, { status: 400 });
  if (message.length < 2 || message.length > 4000) return Response.json({ error: "Write a message (up to 4,000 characters)." }, { status: 400 });
  // Hidden field only bots fill in: accept quietly, keep nothing.
  if (typeof body?.company === "string" && body.company) return Response.json({ ok: true });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const times = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= PER_WINDOW) return Response.json({ error: "Too many messages. Try again later." }, { status: 429 });
  recent.set(ip, [...times, now]);

  const entry = { at: new Date(now).toISOString(), email, message };
  // The local copy works on a normal server; on Vercel the disk is read-only, so email is the delivery there.
  let kept = false;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(path.join(DATA_DIR, "inquiries.jsonl"), JSON.stringify(entry) + "\n");
    kept = true;
  } catch (error) {
    console.error("contact: could not keep a local copy", error);
  }

  const key = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO;
  let sent = false;
  if (key && to) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.CONTACT_FROM || "Mavya <onboarding@resend.dev>",
          to: [to],
          reply_to: email,
          subject: `Mavya Business: ${email}`,
          text: `${message}\n\nFrom: ${email}\nSent: ${entry.at}`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) sent = true;
      else console.error("contact: email failed", res.status, await res.text().catch(() => ""));
    } catch (error) {
      console.error("contact: email failed", error);
    }
  }
  if (!kept && !sent) return Response.json({ error: "Couldn't send. Email hello@mavya.app instead." }, { status: 500 });
  return Response.json({ ok: true });
}
