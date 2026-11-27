import { beginAI, finishAI } from "@/lib/server/ai-budget";
import { GeminiError, PRO_MODEL, geminiJSON } from "@/lib/server/gemini";
import { getRun, getReference, listReferences, mediaAccess, mediaToFile } from "@/lib/server/store";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { currentUser, signInFirst } from "@/lib/server/who";
import type { Reference, ShotExample, VideoScript } from "@/lib/types";
import { scriptRulesText } from "@/lib/script-rules";
import { reelCode } from "@/lib/edit";

/**
 * Write the video script for this run's product and hook (on the "Write my script" click):
 * the hook's on-screen text (and two alternatives), what the character does beat by beat, and the demo shot by shot.
 * It is modelled on data, not made up: the chosen library hook's recipe is the template, and the strongest analyzed
 * hooks in the library (same style, most views) are the patterns. A described hook ("Describe your own") is turned
 * into beats the same way, so it follows what already worked.
 */
export const maxDuration = 180;
type Recipe = {
  hook?: { end?: number; camera?: string; setting?: string; mood?: string; spoken?: string; beats?: { start: number; end: number; action: string }[] };
  onScreenText?: { text: string; start?: number; end?: number; style?: string; position?: string }[];
  demo?: { method?: string; pacing?: string; shots?: { label?: string; seconds?: number; text?: string; hint?: string; camera?: string; steps?: string[] }[] };
  whyItWorks?: string;
};
/** At most 10 shots; when there are more, the first 9 and the last (the payoff). */
export const capShots = <T,>(shots: T[]): T[] => (shots.length > 10 ? [...shots.slice(0, 9), shots[shots.length - 1]] : shots);
const recipeOf = (r: Reference) => (r as Reference & { recipe?: Recipe }).recipe;
/** The library reel's code (its Instagram shortcode), used to play its moments as examples. */
const codeOf = (r: Reference | null) => reelCode(r?.sourceUrl);
/** The stolen shot `n` (1-based) as a "Like this" example, when its times are known. */
export function exampleOf(source: Reference | null, n: unknown): ShotExample | undefined {
  const code = codeOf(source);
  const shot = typeof n === "number" && Number.isInteger(n) && n >= 1 && source ? recipeOf(source)?.demo?.shots?.[n - 1] as { start?: number; end?: number } | undefined : undefined;
  if (!shot || !/^[A-Za-z0-9_-]{5,40}$/.test(code) || typeof shot.start !== "number" || typeof shot.end !== "number" || shot.end <= shot.start) return undefined;
  return { code, start: shot.start, end: shot.end };
}

/** The stolen hook in full: its demo shot by shot (camera, actions, captions, timing) is the template for the new one. */
function template(r: Reference) {
  const rc = recipeOf(r)!;
  return {
    ...sample(r),
    demoMethod: rc.demo?.method ?? "",
    demoPacing: rc.demo?.pacing ?? "",
    // n numbers the shots, so each new shot can say which one it copies (its "Like this" example).
    demo: (rc.demo?.shots ?? []).map((s, i) => ({ n: i + 1, label: s.label, seconds: s.seconds, camera: s.camera, steps: s.steps, hint: s.hint, text: s.text })),
    onScreenText: ((rc.onScreenText ?? []) as NonNullable<Recipe["onScreenText"]>).map((t) => ({ text: t.text, style: t.style, position: t.position })),
  };
}

/** A library hook, compact enough to put a few in one prompt. */
function sample(r: Reference) {
  const rc = recipeOf(r)!;
  return {
    views: r.views ?? null,
    hookText: rc.onScreenText?.[0]?.text ?? "",
    hookAction: (rc.hook?.beats ?? []).map((b) => b.action).join(" / "),
    hookSeconds: rc.hook?.end ?? null,
    demo: (rc.demo?.shots ?? []).map((s) => ({ label: s.label, seconds: s.seconds, text: s.text })),
    whyItWorks: rc.whyItWorks ?? "",
  };
}

/**
 * The seller's product photos and short videos, inline (max 5, only their own media); unreadable ones are skipped.
 * Inline requests stay under Gemini's ~20 MB limit (base64 adds a third): files past 12 MB in all are left out.
 */
async function productScreens(ids: string[], who: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-screens-"));
  try {
    const files = await Promise.all(ids.slice(0, 5).map(async (id) => {
      // Such a file cannot fit in the existing 12 MB inline budget. Reject it before downloading and buffering
      // up to five 300 MB uploads in a function that will discard them anyway.
      const access = await mediaAccess(id, who).catch(() => null);
      if (!access || access.size > 12 * 1024 * 1024) return null;
      const media = await mediaToFile(id, who, dir).catch(() => null);
      if (!media || !/^(image\/(png|jpeg|webp)|video\/(mp4|quicktime|webm))$/.test(media.mime)) return null;
      return { mime: media.mime, bytes: await readFile(media.file) };
    }));
    let room = 12 * 1024 * 1024;
    const parts: { inline_data: { mime_type: string; data: string } }[] = [];
    for (const f of files) {
      if (!f || f.bytes.length > room) continue;
      room -= f.bytes.length;
      parts.push({ inline_data: { mime_type: f.mime, data: f.bytes.toString("base64") } });
    }
    return parts;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SCHEMA = {
  type: "OBJECT",
  // payoff and story first: the model settles what the video pays off and the order it is told in before it writes the shots.
  propertyOrdering: ["payoff", "story", "shotPlan", "hookText", "hookAlternatives", "hookBeats", "shots"],
  properties: {
    payoff: { type: "STRING", description: "the stolen video's payoff and this product's equivalent concrete win" },
    story: { type: "ARRAY", items: { type: "STRING" }, description: "the storyline, one short line per beat, in the viral reel's own story shape" },
    shotPlan: { type: "STRING", description: "one line: how many demo shots and why that count is most likely to get the most views for this app and this reel" },
    hookText: { type: "STRING", description: "on-screen hook text for this product" },
    hookAlternatives: { type: "ARRAY", items: { type: "STRING" }, description: "exactly 2 other hook texts" },
    hookBeats: { type: "ARRAY", items: { type: "OBJECT", properties: { start: { type: "NUMBER" }, end: { type: "NUMBER" }, action: { type: "STRING" } }, required: ["start", "end", "action"] } },
    shots: {
      type: "ARRAY",
      maxItems: 10,
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          hint: { type: "STRING" },
          steps: { type: "ARRAY", items: { type: "STRING" } },
          camera: { type: "STRING" },
          text: { type: "STRING" },
          seconds: { type: "NUMBER" },
          copies: { type: "INTEGER", description: "n of the stolen video's demo shot this shot recreates (shown beside it as the example); 0 if none" },
        },
        required: ["label", "hint", "steps", "camera", "text", "seconds", "copies"],
      },
    },
  },
  required: ["payoff", "story", "shotPlan", "hookText", "hookAlternatives", "hookBeats", "shots"],
};

export async function POST(_request: Request, ctx: RouteContext<"/api/runs/[id]/script">) {
  // One deadline for the whole click (Codex 2026-11-26): 10 s of the 180 s kept to save and answer.
  const deadline = Date.now() + 170_000;
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const run = await getRun(id, who);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const brief = run.product?.brief;
  if (!brief) return Response.json({ error: "Add your product first (step 1)." }, { status: 400 });

  const [refs, source] = await Promise.all([listReferences(who), run.sourceRefId ? getReference(run.sourceRefId, who) : null]);
  const described = !source && run.hook.source === "describe" ? run.hook.describe?.trim() : "";
  if (!source && !described) return Response.json({ error: "Pick a hook first (step 2)." }, { status: 400 });
  const style = source?.ai?.style;
  const examples = refs
    .filter((r) => r.id !== source?.id && recipeOf(r)?.demo?.shots?.length && (!style || r.ai?.style === style))
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, 8)
    .map(sample);

  const stolen = source && recipeOf(source) ? JSON.stringify(template(source)) : null;
  const screens = await productScreens(run.productScreens ?? [], who);
  const notes = run.productNotes?.trim().slice(0, 2000) ?? "";
  const prompt = `You write short-form marketing videos (HOOK + DEMO) for software founders. Quality comes from data:
copy what already went viral, adapted to this product. Never invent features, numbers or results the brief and the founder's notes do not support.

PRIORITY, in this order (founder's rule):
1. ${stolen ? "THE VIRAL REEL THE FOUNDER PICKED leads: most of the script is its format copied to this product (its hook structure, rhythm, tone, length, caption style and story shape). Only the subject changes." : "THE HOOK THE FOUNDER DESCRIBED leads, shaped like the strongest library reels."}
2. THE TRUTH ABOUT THIS PRODUCT: only its real features, flow and results.
3. HOUSE RULES (learned from reels that got views): apply them only where the reel does not already decide, or where copying it would not work for an app. Never let them override the reel's voice.
${scriptRulesText()}

THE PRODUCT (read from its website):
${JSON.stringify(brief)}
${notes ? `\nTHE FOUNDER'S OWN NOTES (they know the product best; where they differ from the website, follow the notes):\n${JSON.stringify(notes)}\n` : ""}${screens.length ? `\nPHOTOS AND VIDEOS OF THE REAL PRODUCT follow this text (${screens.length}). Name the exact screens, buttons and labels you see in them in hint, steps and text ("Tap Remix", not "Tap the button").\n` : ""}
${stolen ? `THE VIDEO THE FOUNDER STOLE (an analyzed viral video; recreate it for THIS product: its hook structure, rhythm,
tone and length, and its demo shot for shot):
${stolen}` : `THE HOOK THE FOUNDER DESCRIBED (turn it into beats, in the style of the examples):
${described}`}

THE STRONGEST HOOKS IN THE LIBRARY (analyzed viral videos, for patterns of hook text, pacing and demo structure):
${JSON.stringify(examples)}

THE VIDEO TELLS ONE STORY. Keep the viral reel's own story shape; where it has none that fits an app, use this one (the offer formula: a big dream outcome, proof it works, little time, little effort):
1. HOOK: the stolen hook, recreated.
2. BEFORE (the pain; skip this shot only when the hook already shows it): the problem this product solves, shown on screen as it looks today (e.g. for a video tool "Show a video that gets low views"; for a sales tool "Show your Stripe with no sales").
3. THE STEPS: the product's real main flow, one shot per step, in the order it is used. Make it look as easy as it truly is: the fewest taps the product really needs, nothing extra (no sign up, settings or menus unless they are the point). Never skip a step the product needs and never add a button it does not have.
4. AFTER: the pain from the hook or BEFORE, now fixed: the dream outcome (e.g. "Show a video that gets high views", "Show your Stripe with sales going up"). If the product has no clear before and after, end on the finished result instead.
5. CLOSE: the stolen video's closing line or call to action, if it has one (can share the AFTER shot).
Each shot follows from the one before; read in order, the captions tell the story with no jumps. Captions describe before and after in words; use numbers only if the founder's notes give them.

Write:
- story (write it right after payoff): the storyline above for THIS product, one short line per beat.
- hookText: the on-screen hook text for THIS product, in the same voice and length as the hook to recreate (lowercase, slang and emoji only if it uses them). It must make people curious about what is on the screen, without naming the product yet.
- hookAlternatives: 2 other hook texts in the same voice.
- hookBeats: what the person does in the hook, beat by beat with seconds, each action under 12 plain words.${stolen ? " Copy the stolen video's hook exactly: the same actions, expression, gestures and timing (it is recreated from that clip); only the words on screen change." : ""} Say "the creator", never describe a real person.
- payoff (write it first): ${stolen ? "what the stolen video's hook promises and how its demo pays that off (e.g. \"gets paid $4k for a website the AI built in minutes\"), then THIS product's equivalent concrete win, taken only from the brief" : "the concrete win this product delivers, taken only from the brief"}. One sentence.
- shotPlan (write it right after story): decide the number of demo shots with your own judgment: the count most likely to get this reel the most views for THIS app (its real flow, the reel's pace, how fast it reaches the payoff). There is no default count; it can be 2 or 9 (at most 10). Say the count and why in one line.
- shots: the demo for THIS product, following the story, exactly as many shots as shotPlan says.${stolen ? ` Copy the stolen demo's FORM, not its actions or timings: its caption voice (casing, slang, emoji), its rhythm (quick steps, then the payoff) and its closing call to action if it has one. Every action happens in THIS product, from its demoFlow${screens.length ? " and the screenshots" : ""}; never copy the stolen video's gestures or props (yawning, thumbs up, leaning back) unless they are the payoff reaction.` : ` Follow the strongest library demos' structure and the product's demoFlow.`} Every shot must earn its place; when unsure, choose fewer.
  SECONDS come from THIS product's action, never from the viral reel's shot lengths: a tap or a pick 1 to 2 seconds, a scroll 2 to 3, the result 2 to 4. A demo is fast; a 6 second shot needs a real reason.
  CAPTIONS (text): every shot has one, even when the viral reel's demo has none: 2 to 5 words in the hook's voice, telling the story shot by shot, so the captions read alone make sense ("my app demo flopped💀", "found a 5.6M hook👀", "picked an AI face", "went viral🚀"). Never empty, never a repeat of the hook text.
  The last shot shows the RESULT the product promises (the finished thing working, or the founder's real numbers if the notes give them), not just the app's last screen.
  ${stolen ? `COPIES: each shot recreates one shot of the stolen demo (its n), the one it matches most closely, as close to it as THIS product allows (same kind of action, same framing, same moment in the story), so the founder sees that original moment beside it and copies it. Say which in copies.
  ` : ""}For each: label (2 to 4 plain words, no marketing jargon such as CTA), hint (one short sentence saying exactly what is on screen, naming the real screen, button or label, e.g. "Tap Use this hook under a reel with 5M views."), steps (1 to 3 short, specific on-screen actions in the real product: name the screen and the button, never "record your app" or "use the app"; when the brief, notes or screenshots do not name a button, describe what is visibly on screen instead, and never invent one such as a record or export button), camera (how to hold the phone and what to point it at), text (the caption), seconds, copies.

BE EXTREMELY SPECIFIC TO THIS PRODUCT (founder's rule): every hint and step names the real screen and, where the product shows one, quotes the
real button, tab or field in double quotes (where none is known, say exactly what is visible instead), using the words in the brief's uiWords (each says in brackets what it is: only tap what is a button, only pick what is a choice) and demoFlow${screens.length ? ", the screenshots" : ""}${notes ? " and the notes" : ""}
(e.g. 'Tap "Use this hook" under the 5.6M-view reel', not "Tap a hook"). Every shot also says what real example is on
screen (which item, which number, what the result looks like), taken from the brief, never invented. Test each shot:
could a stranger film it without asking a single question? If not, rewrite it. Quote a label only when it helps
someone film the step; never quote tags, headers or counters just to quote them.

Write hint, steps and camera for someone who has never filmed before: simple everyday English a 10-year-old understands,
short words, no film or marketing terms (no "screen capture", "B-roll", "angle", "framing", "CTA", "split screen", "POV", "close-up", "handheld").
Say what to hold, where to point it and what to tap, e.g. camera "Hold your phone above the plate and point it down",
step "Tap the big camera button".`;

  const budget = await beginAI(who, run, "script", { product: run.product, source: source, described });
  if (budget.response) return budget.response;
  let out: Omit<VideoScript, "refId" | "at"> & { shotPlan?: unknown };
  try {
    // Gemini Pro writes the script (founder 2026-11-26: judgment of story and shot count); if it fails or runs out of
    // its time, Flash writes it instead. Both share the click's deadline: Pro always leaves Flash 45 s, and Flash
    // is skipped when under 15 s remain.
    const parts = screens.length ? [{ text: prompt }, ...screens] : prompt;
    const left = () => deadline - Date.now();
    out = await geminiJSON<typeof out>(parts, { schema: SCHEMA, temperature: 0.6, model: PRO_MODEL, timeoutMs: Math.max(1_000, Math.min(110_000, left() - 45_000)) })
      .catch((error) => {
        console.error("script: pro failed, using flash", error instanceof Error ? error.message.slice(0, 200) : error);
        if (left() < 15_000) throw new GeminiError("No time left for the fallback.");
        return geminiJSON<typeof out>(parts, { schema: SCHEMA, temperature: 0.6, timeoutMs: left() });
      });
  } catch (e) {
    console.error("script", e);
    return Response.json({ error: e instanceof GeminiError ? "Couldn't write the script. Try again." : "Something went wrong." }, { status: 502 });
  }
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const script: VideoScript = {
    hookText: s(out.hookText, 200),
    hookAlternatives: (Array.isArray(out.hookAlternatives) ? out.hookAlternatives : []).map((x) => s(x, 200)).filter(Boolean).slice(0, 2),
    hookBeats: (Array.isArray(out.hookBeats) ? out.hookBeats : []).slice(0, 8).map((b) => ({ start: num(b?.start, 0, 30, 0), end: num(b?.end, 0, 30, 1), action: s(b?.action, 300) })),
    // The count is the model's judgment (founder 2026-11-26); 10 is only a safety cap, and past it the last shot
    // (the payoff) is kept (Codex 2026-11-26).
    shots: capShots(Array.isArray(out.shots) ? out.shots : []).map((x) => ({
      label: s(x?.label, 60),
      hint: s(x?.hint, 300),
      steps: (Array.isArray(x?.steps) ? x.steps : []).map((y) => s(y, 160)).filter(Boolean).slice(0, 3),
      camera: s(x?.camera, 160),
      text: s(x?.text, 200),
      seconds: num(x?.seconds, 0.5, 15, 3),
      ...(exampleOf(source, (x as { copies?: unknown })?.copies) ? { example: exampleOf(source, (x as { copies?: unknown })?.copies) } : {}),
    })),
    ...(s(out.shotPlan, 300) ? { shotPlan: s(out.shotPlan, 300) } : {}),
    refId: source?.id ?? null,
    at: new Date().toISOString(),
  };
  if (!script.hookText || !script.shots.length) return Response.json({ error: "Couldn't write the script. Try again." }, { status: 502 });
  return finishAI(who, run, "script", budget.token!, { script });
}
