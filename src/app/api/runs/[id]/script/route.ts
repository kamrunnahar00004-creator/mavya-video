import { beginAI, finishAI } from "@/lib/server/ai-budget";
import { GeminiError, geminiJSON } from "@/lib/server/gemini";
import { getRun, getReference, listReferences, mediaToFile } from "@/lib/server/store";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { currentUser, signInFirst } from "@/lib/server/who";
import type { Reference, VideoScript } from "@/lib/types";

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
const recipeOf = (r: Reference) => (r as Reference & { recipe?: Recipe }).recipe;

/** The stolen hook in full: its demo shot by shot (camera, actions, captions, timing) is the template for the new one. */
function template(r: Reference) {
  const rc = recipeOf(r)!;
  return {
    ...sample(r),
    demoMethod: rc.demo?.method ?? "",
    demoPacing: rc.demo?.pacing ?? "",
    demo: (rc.demo?.shots ?? []).map((s) => ({ label: s.label, seconds: s.seconds, camera: s.camera, steps: s.steps, hint: s.hint, text: s.text })),
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
  propertyOrdering: ["payoff", "story", "hookText", "hookAlternatives", "hookBeats", "shots"],
  properties: {
    payoff: { type: "STRING", description: "the stolen video's payoff and this product's equivalent concrete win" },
    story: { type: "ARRAY", items: { type: "STRING" }, description: "the storyline, one short line per beat: hook, before, each step, after, close" },
    hookText: { type: "STRING", description: "on-screen hook text for this product" },
    hookAlternatives: { type: "ARRAY", items: { type: "STRING" }, description: "exactly 2 other hook texts" },
    hookBeats: { type: "ARRAY", items: { type: "OBJECT", properties: { start: { type: "NUMBER" }, end: { type: "NUMBER" }, action: { type: "STRING" } }, required: ["start", "end", "action"] } },
    shots: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          hint: { type: "STRING" },
          steps: { type: "ARRAY", items: { type: "STRING" } },
          camera: { type: "STRING" },
          text: { type: "STRING" },
          seconds: { type: "NUMBER" },
        },
        required: ["label", "hint", "steps", "camera", "text", "seconds"],
      },
    },
  },
  required: ["payoff", "story", "hookText", "hookAlternatives", "hookBeats", "shots"],
};

export async function POST(_request: Request, ctx: RouteContext<"/api/runs/[id]/script">) {
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

THE PRODUCT (read from its website):
${JSON.stringify(brief)}
${notes ? `\nTHE FOUNDER'S OWN NOTES (they know the product best; where they differ from the website, follow the notes):\n${JSON.stringify(notes)}\n` : ""}${screens.length ? `\nPHOTOS AND VIDEOS OF THE REAL PRODUCT follow this text (${screens.length}). Name the exact screens, buttons and labels you see in them in hint, steps and text ("Tap Remix", not "Tap the button").\n` : ""}
${stolen ? `THE VIDEO THE FOUNDER STOLE (an analyzed viral video; recreate it for THIS product: its hook structure, rhythm,
tone and length, and its demo shot for shot):
${stolen}` : `THE HOOK THE FOUNDER DESCRIBED (turn it into beats, in the style of the examples):
${described}`}

THE STRONGEST HOOKS IN THE LIBRARY (analyzed viral videos, for patterns of hook text, pacing and demo structure):
${JSON.stringify(examples)}

THE VIDEO TELLS ONE STORY, in this order (the offer formula: a big dream outcome, proof it works, little time, little effort):
1. HOOK: the stolen hook, recreated.
2. BEFORE: the problem this product solves, shown on screen as it looks today (e.g. for a video tool "Show a video that gets low views"; for a sales tool "Show your Stripe with no sales").
3. THE STEPS: the product's real main flow, one shot per step, in the order it is used. Make it look as easy as it truly is: the fewest taps the product really needs, nothing extra (no sign up, settings or menus unless they are the point). Never skip a step the product needs and never add a button it does not have.
4. AFTER: the same thing as BEFORE, now fixed: the dream outcome (e.g. "Show a video that gets high views", "Show your Stripe with sales going up"). If the product has no clear before and after, end on the finished result instead.
5. CLOSE: the stolen video's closing line or call to action, if it has one (can share the AFTER shot).
Each shot follows from the one before; read in order, the captions tell the story with no jumps. Captions describe before and after in words; use numbers only if the founder's notes give them.

Write:
- story (write it right after payoff): the storyline above for THIS product, one short line per beat.
- hookText: the on-screen hook text for THIS product, in the same voice and length as the hook to recreate (lowercase, slang and emoji only if it uses them). It must make people curious about what is on the screen, without naming the product yet.
- hookAlternatives: 2 other hook texts in the same voice.
- hookBeats: what the person does in the hook, beat by beat with seconds, each action under 12 plain words.${stolen ? " Copy the stolen video's hook exactly: the same actions, expression, gestures and timing (it is recreated from that clip); only the words on screen change." : ""} Say "the creator", never describe a real person.
- payoff (write it first): ${stolen ? "what the stolen video's hook promises and how its demo pays that off (e.g. \"gets paid $4k for a website the AI built in minutes\"), then THIS product's equivalent concrete win, taken only from the brief" : "the concrete win this product delivers, taken only from the brief"}. One sentence.
- shots: the demo for THIS product, following the story: BEFORE, the steps, AFTER (3 to 7 shots).${stolen ? ` Copy the stolen demo's FORM, not its actions: its numbered caption style, its rhythm (quick steps, then the payoff), the caption length, casing and emoji, and its closing call to action if it has one. Every action happens in THIS product, from its demoFlow${screens.length ? " and the screenshots" : ""}; never copy the stolen video's gestures or props (yawning, thumbs up, leaning back) unless they are the payoff reaction.` : ` Follow the strongest library demos' structure and pacing and the product's demoFlow.`} Use as many step shots as this product's real flow needs. Seconds follow each action: quick taps 1.5 to 3 seconds, the AFTER shot the longest. The last shot and its caption deliver the payoff. For each: label (2 to 4 plain words, no marketing jargon such as CTA), hint (one short imperative sentence, the action to record, e.g. "Open the Wingmates app."), steps (1 to 3 short on-screen actions in the real product), camera (how to hold the phone and what to point it at), text (the on-screen caption for that shot, same voice as the hook), seconds.

Write hint, steps and camera for someone who has never filmed before: simple everyday English a 10-year-old understands,
short words, no film or marketing terms (no "screen capture", "B-roll", "angle", "framing", "CTA", "split screen").
Say what to hold, where to point it and what to tap, e.g. camera "Hold your phone above the plate and point it down",
step "Tap the big camera button".`;

  const budget = await beginAI(who, run, "script", { product: run.product, source: source, described });
  if (budget.response) return budget.response;
  let out: Omit<VideoScript, "refId" | "at">;
  try {
    out = await geminiJSON(screens.length ? [{ text: prompt }, ...screens] : prompt, { schema: SCHEMA, temperature: 0.6 });
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
    shots: (Array.isArray(out.shots) ? out.shots : []).slice(0, 7).map((x) => ({
      label: s(x?.label, 60),
      hint: s(x?.hint, 300),
      steps: (Array.isArray(x?.steps) ? x.steps : []).map((y) => s(y, 160)).filter(Boolean).slice(0, 3),
      camera: s(x?.camera, 160),
      text: s(x?.text, 200),
      seconds: num(x?.seconds, 0.5, 15, 3),
    })),
    refId: source?.id ?? null,
    at: new Date().toISOString(),
  };
  if (!script.hookText || !script.shots.length) return Response.json({ error: "Couldn't write the script. Try again." }, { status: 502 });
  return finishAI(who, run, "script", budget.token!, { script });
}
