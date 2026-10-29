import { beginAI, finishAI } from "@/lib/server/ai-budget";
import { GeminiError, geminiJSON } from "@/lib/server/gemini";
import { getRun, getReference, listReferences } from "@/lib/server/store";
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

const SCHEMA = {
  type: "OBJECT",
  properties: {
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
  required: ["hookText", "hookAlternatives", "hookBeats", "shots"],
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
  const prompt = `You write short-form marketing videos (HOOK + DEMO) for software founders. Quality comes from data:
copy what already went viral, adapted to this product. Never invent features, numbers or results the brief does not support.

THE PRODUCT (read from its website):
${JSON.stringify(brief)}

${stolen ? `THE VIDEO THE FOUNDER STOLE (an analyzed viral video; recreate it for THIS product: its hook structure, rhythm,
tone and length, and its demo shot for shot):
${stolen}` : `THE HOOK THE FOUNDER DESCRIBED (turn it into beats, in the style of the examples):
${described}`}

THE STRONGEST HOOKS IN THE LIBRARY (analyzed viral videos, for patterns of hook text, pacing and demo structure):
${JSON.stringify(examples)}

Write:
- hookText: the on-screen hook text for THIS product, in the same voice and length as the hook to recreate (lowercase, slang and emoji only if it uses them). It must make people curious about what is on the screen, without naming the product yet.
- hookAlternatives: 2 other hook texts in the same voice.
- hookBeats: what the person does in the hook, beat by beat with seconds.${stolen ? " Copy the stolen video's hook exactly: the same actions, expression, gestures and timing (it is recreated from that clip); only the words on screen change." : ""} Say "the creator", never describe a real person.
- shots: the demo for THIS product, 3 to 6 shots, ending on the wow moment.${stolen ? ` Mirror the stolen video's demo shot for shot: the same number of shots where the product allows, the same order of beats, about the same seconds per shot, the same camera setups and the same on-screen text format (numbering, length, casing, emoji, and a closing call to action if it has one). Swap in THIS product's real screens and actions from its demoFlow; keep the form, change the content.` : ` Follow the strongest library demos' structure and pacing and the product's demoFlow.`} For each: label (2 to 4 words), hint (one short imperative sentence, the action to record, e.g. "Open the Wingmates app."), steps (1 to 3 short on-screen actions in the real product), camera (how to hold the phone, specific: angle, distance, what is in frame), text (the on-screen caption for that shot, same voice as the hook), seconds.`;

  const budget = await beginAI(who, run, "script", { product: run.product, source: source, described });
  if (budget.response) return budget.response;
  let out: Omit<VideoScript, "refId" | "at">;
  try {
    out = await geminiJSON(prompt, { schema: SCHEMA, temperature: 0.6 });
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
    shots: (Array.isArray(out.shots) ? out.shots : []).slice(0, 6).map((x) => ({
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
