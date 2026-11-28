import "server-only";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { geminiJSON, type GeminiPart } from "@/lib/server/gemini";
import { mediaAccess, mediaToFile, updateReference } from "@/lib/server/store";
import { allowance } from "@/lib/server/usage";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { Reference } from "@/lib/types";

/**
 * A user's own uploaded reel gets the same breakdown as a library reel (founder 2026-11-28): Gemini Flash reads the
 * video and writes its recipe (hook, on-screen text, the demo shot by shot), so "Get viral script" copies THEIR reel
 * and each shot gets its own "Like this" moment. Same prompt and schema as scripts/curation/recipe.py (keep in step).
 * About 1 to 2 cents a reel, paid from Mavya's Gemini balance, so: only for a plan, trial or admin, and at most
 * DAILY_CAP a day per person (counted in billing_events, no migration). Runs after the upload answers; never fails it.
 */

export const DAILY_CAP = 10;
const MODEL = "gemini-flash-latest";
/** Gemini takes about 20 MB per request; base64 makes a file a third bigger, so above 14 MB use its Files API (Codex). */
const INLINE_MAX = 14 * 1024 * 1024;
/** Bigger than any reel: a long upload is not a reel to copy, and would cost more. Checked before downloading. */
const MAX_BYTES = 100 * 1024 * 1024;
/** All of it must finish inside the route's 300 s (maxDuration), with room to save (Codex 2026-11-28). */
const BUDGET_MS = 260_000;

export const PROMPT = `You are a short-form video producer. Break down this HOOK + DEMO marketing video into a production recipe
that another creator can follow to recreate the same video for THEIR OWN software product.

Be concrete and time-coded (seconds). Describe what the camera sees, not the identity of the person
(never describe the person's face, ethnicity or name; say "the creator"). Keep the person's actions, expression, outfit style and setting.

The video has two parts and only two: the HOOK (a person, until the first cut to the software) and the DEMO
(the software being shown, until the end). Any call to action is part of the demo; do not treat it separately.

Sections:
- hook: the opening until the first cut to the demo. "end" must be the exact second of that cut.
- onScreenText: every text overlay in the whole video, exact words, when it shows, where on screen, style.
- demo: how the software is shown, and the demo split into 3 to 6 SHOTS. Each shot is a step another founder will
  film for THEIR OWN app: "label" is a 2 to 4 word title ("The question", "Say yes"), "hint" says what to film in one
  plain sentence written to them ("Film your laptop over your shoulder as the link pops up"), "steps" are 1 to 3 short
  actions to do on screen, "camera" is how to hold the phone, "text" is the original on-screen text during that shot
  (exact words, empty if none), "seconds" is its length.
- whyItWorks: 1 or 2 sentences from a marketer's angle (the tension, the payoff, why people watch to the end).
- hookPrompt: a prompt for an AI video model to generate a NEW hook clip in the same style. Use {CHARACTER} where the person goes.
  Include setting, lighting, framing, camera movement and the action beat by beat with timings. NO on-screen text in this prompt.
  Change small details (room, colors, props) so it is close but not a copy.

Caption (may help identify the product): {caption}`;

const STR = { type: "STRING" };
const NUM = { type: "NUMBER" };
export const SCHEMA = {
  type: "OBJECT",
  properties: {
    hook: { type: "OBJECT", properties: {
      end: { type: "NUMBER", description: "seconds where the hook ends" },
      setting: STR, lighting: STR, outfit: STR,
      camera: { type: "STRING", description: "framing, angle, handheld or fixed, movement" },
      mood: STR,
      spoken: { type: "STRING", description: "exact words spoken in the hook, empty if none" },
      beats: { type: "ARRAY", items: { type: "OBJECT", properties: { start: NUM, end: NUM, action: STR }, required: ["start", "end", "action"] } },
    }, required: ["end", "setting", "lighting", "outfit", "camera", "mood", "spoken", "beats"] },
    onScreenText: { type: "ARRAY", items: { type: "OBJECT", properties: {
      text: STR, start: NUM, end: NUM,
      position: { type: "STRING", description: "top, center, bottom..." },
      style: { type: "STRING", description: "font look, color, outline/box" },
    }, required: ["text", "start", "end", "position", "style"] } },
    demo: { type: "OBJECT", properties: {
      method: { type: "STRING", enum: ["phone_filming_laptop", "phone_filming_monitor", "phone_filming_phone", "screen_recording", "mixed"] },
      product: STR, duration: NUM,
      pacing: { type: "STRING", description: "how fast, how many cuts, where the wow moment lands" },
      spoken: { type: "STRING", description: "voiceover during the demo, empty if none" },
      shots: { type: "ARRAY", items: { type: "OBJECT", properties: {
        start: NUM, end: NUM,
        label: { type: "STRING", description: "2 to 4 word title of the step" },
        hint: { type: "STRING", description: "one sentence: what to film, written to the founder, for their own app" },
        steps: { type: "ARRAY", items: STR, description: "1 to 3 short on-screen actions" },
        camera: { type: "STRING", description: "how to hold the phone: over the shoulder, close on the screen..." },
        text: { type: "STRING", description: "original on-screen text during this shot, exact words, empty if none" },
        seconds: NUM,
      }, required: ["start", "end", "label", "hint", "steps", "camera", "text", "seconds"] } },
      resultReveal: STR,
    }, required: ["method", "product", "duration", "pacing", "spoken", "shots", "resultReveal"] },
    sound: { type: "STRING", description: "trending music, voiceover, sound effects" },
    whyItWorks: STR,
    hookPrompt: STR,
  },
  required: ["hook", "onScreenText", "demo", "sound", "whyItWorks", "hookPrompt"],
};

type Shot = { start: number; end: number; label: string; hint: string; steps: string[]; camera: string; text: string; seconds: number };
type Answer = { hook: { end: number }; demo: { shots: Shot[] } } & Record<string, unknown>;

/** A usable answer: a hook end inside the video and at least one shot with real times after it. */
export function usable(a: unknown): a is Answer {
  const r = a as Answer | null;
  if (!r || typeof r !== "object" || typeof r.hook?.end !== "number" || !(r.hook.end > 0)) return false;
  const shots = r.demo?.shots;
  return Array.isArray(shots) && shots.some((s) => s && typeof s.start === "number" && typeof s?.end === "number" && s.end > s.start && typeof s.label === "string");
}

/** Shots kept in order, inside the video, starting after the hook (the library rule: a demo shot never shows the hook). */
export function tidy(a: Answer): Answer {
  const hookEnd = a.hook.end;
  const shots = a.demo.shots
    .filter((s) => s && typeof s === "object" && typeof s.start === "number" && typeof s.end === "number" && s.end > s.start && s.end > hookEnd)
    .map((s) => {
      const start = s.start >= hookEnd ? s.start : Math.round((hookEnd + 0.1) * 100) / 100;
      return { ...s, start, seconds: Math.round((s.end - start) * 100) / 100 }; // the length always matches the times
    })
    .filter((s) => s.end > s.start)
    .sort((x, y) => x.start - y.start)
    .slice(0, 8);
  return { ...a, demo: { ...a.demo, shots } };
}

const today = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Reserves one of today's analyses for this person: DAILY_CAP numbered slots a day, each a billing_events row whose
 * insert fails once taken, so uploads at the same moment can never pass the cap (Codex 2026-11-28). False when all
 * are used or the ledger is unavailable.
 */
export async function reserve(who: string, now = new Date(), db = createSupabaseAdminClient()): Promise<boolean> {
  const prefix = `user-recipe:${who}:${today(now)}:`;
  for (let n = 1; n <= DAILY_CAP; n++) {
    const { error } = await db.from("billing_events").insert({ id: `${prefix}${n}`, type: "user.recipe" });
    if (!error) return true;
    if (error.code !== "23505") return false; // anything but "slot taken": stop, spend nothing
  }
  return false;
}

/** Plan, trial or admin: who may spend Mavya's AI. */
export async function mayAnalyze(who: string): Promise<boolean> {
  try {
    const a = await allowance(who);
    return Boolean(a.plan || a.admin || a.limit === null);
  } catch {
    return false;
  }
}

/** Gemini's Files API for a video too big to send inline; waits until it can be read. */
async function uploadFile(bytes: Buffer, mime: string, key: string, fetcher: typeof fetch, deadline: number, named: (name: string) => void): Promise<{ uri: string; name: string }> {
  const start = await fetcher("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: { "x-goog-api-key": key, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(bytes.length), "X-Goog-Upload-Header-Content-Type": mime, "content-type": "application/json" },
    body: JSON.stringify({ file: { display_name: "reel" } }),
    signal: AbortSignal.timeout(30_000),
  });
  const url = start.headers.get("x-goog-upload-url");
  if (!start.ok || !url) throw new Error(`Gemini upload start ${start.status}`);
  const done = await fetcher(url, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(120_000) });
  if (!done.ok) throw new Error(`Gemini upload ${done.status}`);
  let file = ((await done.json()) as { file: { uri: string; name: string; state?: string } }).file;
  named(file.name); // from here on it is deleted afterwards, even if it never becomes ready
  while (file.state !== "ACTIVE" && Date.now() < deadline - 120_000) {
    if (file.state === "FAILED") throw new Error("Gemini could not read the video");
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) file = (await res.json()) as typeof file;
  }
  if (file.state !== "ACTIVE") throw new Error("Gemini video not ready");
  return file;
}

/**
 * Writes the recipe on a user's uploaded reel. Returns why it stopped ("done", "has", "plan", "cap", "file", "failed").
 * Never throws: the upload already succeeded and the app works without a recipe (the script then follows the library).
 */
export async function analyzeUpload(ref: Reference, who: string, deps: {
  fetcher?: typeof fetch;
  ask?: (parts: GeminiPart[]) => Promise<unknown>;
  may?: (who: string) => Promise<boolean>;
  reserveSlot?: (who: string) => Promise<boolean>;
  read?: (mediaId: string, who: string) => Promise<{ bytes: Buffer; mime: string } | null>;
  now?: () => number;
  save?: (id: string, recipe: Record<string, unknown>, who: string) => Promise<unknown>;
} = {}): Promise<string> {
  if (ref.owner !== "user" || ref.recipe?.demo?.shots?.length) return "has";
  const key = process.env.GEMINI_API_KEY;
  if (!key && !deps.ask) return "failed";
  if (!(await (deps.may ?? mayAnalyze)(who))) return "plan";
  const clock = deps.now ?? Date.now;
  const deadline = clock() + BUDGET_MS;
  let dir: string | null = null;
  try {
    const read = deps.read ?? (async (mediaId: string, user: string) => {
      // Size and type first, so an oversized file is never downloaded (Codex 2026-11-28).
      const info = await mediaAccess(mediaId, user);
      if (!info || !info.mime.startsWith("video/") || info.size > MAX_BYTES) return null;
      dir = await mkdtemp(path.join(tmpdir(), "mavya-recipe-"));
      const got = await mediaToFile(mediaId, user, dir);
      return got ? { bytes: await readFile(got.file), mime: got.mime } : null;
    });
    const media = await read(ref.mediaId, who);
    if (!media || !media.mime.startsWith("video/") || media.bytes.length > MAX_BYTES) return "file";
    // A daily slot is used only for a file Gemini will actually read, with time left to read it (Codex 2026-11-28).
    if (deadline - clock() < 90_000) return "failed";
    if (!(await (deps.reserveSlot ?? ((u: string) => reserve(u)))(who))) return "cap";
    const fetcher = deps.fetcher ?? fetch;
    let uploadedName = "";
    try {
      const video: GeminiPart = media.bytes.length <= INLINE_MAX
        ? { inline_data: { mime_type: media.mime, data: media.bytes.toString("base64") } }
        : { file_data: { mime_type: media.mime, file_uri: (await uploadFile(media.bytes, media.mime, key!, fetcher, deadline, (n) => { uploadedName = n; })).uri } };
      const text = { text: PROMPT.replace("{caption}", (ref.caption || ref.title || "(none)").slice(0, 500)) };
      const left = deadline - clock();
      if (left < 30_000) return "failed";
      const answer = await (deps.ask ?? ((parts) => geminiJSON(parts, { schema: SCHEMA, temperature: 0.2, model: MODEL, timeoutMs: left })))([video, text]);
      // Checked after tidying: an answer whose shots all sit inside the hook is not a breakdown (Codex 2026-11-28).
      const kept = usable(answer) ? tidy(answer) : null;
      if (!kept || !kept.demo.shots.length) return "failed";
      await (deps.save ?? ((id, r, user) => updateReference(id, { recipe: r as Reference["recipe"] }, user)))(ref.id, { ...kept, model: MODEL, at: new Date().toISOString() }, who);
      return "done";
    } finally {
      // Gemini's copy is removed before this ends (awaited, so the function is not stopped first).
      // Gemini also deletes uploaded files itself after 48 hours; a failed delete is only logged.
      if (uploadedName) {
        const gone = await fetcher(`https://generativelanguage.googleapis.com/v1beta/${uploadedName}`, { method: "DELETE", headers: { "x-goog-api-key": key! }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
        if (!gone?.ok) console.error("user recipe: Gemini file not deleted", gone?.status ?? "network");
      }
    }
  } catch (error) {
    console.error("user recipe", error instanceof Error ? error.message.slice(0, 120) : "error");
    return "failed";
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
