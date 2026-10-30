import { beginAI, finishAI } from "@/lib/server/ai-budget";
import { GeminiError, geminiJSON } from "@/lib/server/gemini";
import { getReference, getRun } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";
import type { VideoScript } from "@/lib/types";

/**
 * Regenerate (the icon on the hook text): three new on-screen hook lines for THIS product, in the voice of the video
 * the seller stole, none of them a line they already saw. The first is used now; the other two are the next clicks,
 * free. Counted against the same daily allowance as the script (one AI kind, "script").
 */
export const maxDuration = 60;
const SCHEMA = { type: "OBJECT", properties: { lines: { type: "ARRAY", items: { type: "STRING" } } }, required: ["lines"] };

export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/hook-text">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const run = await getRun(id, who);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const brief = run.product?.brief;
  if (!brief) return Response.json({ error: "Add your product first (step 1)." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { avoid?: unknown } | null;
  const avoid = (Array.isArray(body?.avoid) ? body.avoid : []).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, 30);

  const source = run.sourceRefId ? await getReference(run.sourceRefId, who) : null;
  const described = !source && run.hook.source === "describe" ? run.hook.describe?.trim() : "";
  const recipe = (source as { recipe?: { onScreenText?: { text: string }[]; hook?: { mood?: string } } } | null)?.recipe;
  const voice = source ? { hookText: recipe?.onScreenText?.[0]?.text ?? source.title ?? "", mood: recipe?.hook?.mood ?? "" } : { described };

  const prompt = `Write 3 new on-screen hook texts for a short-form video about this product. Never invent features or results the brief does not support.

THE PRODUCT:
${JSON.stringify({ name: brief.name, oneLiner: brief.oneLiner, audience: brief.audience, problem: brief.problem, wowMoment: brief.wowMoment, ...(run.productNotes?.trim() ? { foundersNotes: run.productNotes.trim().slice(0, 2000) } : {}) })}

THE VIRAL HOOK IT RECREATES (copy its voice, length, casing, slang and emoji use exactly):
${JSON.stringify(voice)}

ALREADY USED, write something different from each:
${JSON.stringify(avoid)}

Each line makes people curious about what is on the screen without naming the product. Answer {"lines": [3 strings]}.`;

  const budget = await beginAI(who, run, "script", { product: run.product, source, described });
  if (budget.response) return budget.response;
  let out: { lines?: unknown };
  try {
    out = await geminiJSON(prompt, { schema: SCHEMA, temperature: 0.9 });
  } catch (e) {
    console.error("hook text", e);
    return Response.json({ error: e instanceof GeminiError ? "Couldn't write a new line. Try again." : "Something went wrong." }, { status: 502 });
  }
  const seen = new Set(avoid.map((x) => x.trim().toLowerCase()));
  const lines = (Array.isArray(out.lines) ? out.lines : []).filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 200)).filter((x) => x && !seen.has(x.toLowerCase())).slice(0, 3);
  if (!lines.length) return Response.json({ error: "Couldn't write a new line. Try again." }, { status: 502 });
  const base: VideoScript = run.script && run.script.refId === (source?.id ?? null) ? run.script : { hookText: "", hookAlternatives: [], hookBeats: [], shots: [], refId: source?.id ?? null, at: new Date().toISOString() };
  return finishAI(who, run, "script", budget.token!, { script: { ...base, hookText: lines[0], hookAlternatives: lines.slice(1) } });
}
