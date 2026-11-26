import "server-only";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { geminiJSON, type GeminiPart } from "@/lib/server/gemini";
import { characterOf, hookVideo } from "@/lib/server/hookgen";
import { mediaToFile } from "@/lib/server/store";
import { CRITERIA, EVAL_SINCE, passes, readScores, type HookEval } from "@/lib/hook-eval";
import type { Reference, Run } from "@/lib/types";

/**
 * Hook eval (founder 2026-11-26): scores each library hook made with a built-in character, after it was delivered,
 * from its own cron (/api/internal/hook-eval), so generation never waits for it (founder rule: never slower). It
 * makes no new generation: one Gemini call reads the made clip, the library hook clip and the character photo.
 */

const MODEL = "gemini-flash-latest";
/** Gemini takes inline files up to about 20 MB in all. */
const MAX_BYTES = 18 * 1024 * 1024;
const db = () => createSupabaseAdminClient();

const SCHEMA = {
  type: "object",
  properties: { ...Object.fromEntries(Object.keys(CRITERIA).map((k) => [k, { type: "integer" }])), notes: { type: "string" } },
  required: [...Object.keys(CRITERIA), "notes"],
};

const PROMPT = `You check an AI-made short video against what it was asked to copy.
Video 1 is the made clip. Video 2 is the original hook it copies. The image is the character whose face must be used.
Score each from 0 to 10 (10 best), strictly; a clip a viewer would find off or creepy scores 5 or less where it fails:
${Object.entries(CRITERIA).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
notes: one short sentence on the biggest problem, or "none".`;

type Row = { id: string; user_id: string; input: Run; reference: Reference | null; result: { src?: string } | null };

/** Scores one generation. Never throws: a failure is saved as the eval, so the cron never loops on it. */
export async function evalGeneration(row: Row, judge: typeof geminiJSON = geminiJSON): Promise<HookEval> {
  const at = new Date().toISOString();
  const dir = await mkdtemp(path.join(tmpdir(), "mavya-eval-"));
  try {
    const made = row.result?.src?.match(/^\/api\/media\/([0-9a-f-]{36}\.mp4)$/)?.[1];
    if (!made) return { failed: "no clip", at };
    const [clip, original, character] = await Promise.all([
      mediaToFile(made, row.user_id, dir),
      hookVideo(row.input, row.reference, row.user_id, dir),
      characterOf(row.input, row.user_id, dir),
    ]);
    if (!clip || !original || !character.image) return { failed: "missing input", at };
    const [a, b] = await Promise.all([readFile(clip.file), readFile(original)]);
    if (a.length + b.length + character.image.data.length > MAX_BYTES) return { failed: "too large", at };
    const parts: GeminiPart[] = [
      { text: PROMPT },
      { inline_data: { mime_type: "video/mp4", data: a.toString("base64") } },
      { inline_data: { mime_type: "video/mp4", data: b.toString("base64") } },
      { inline_data: { mime_type: character.image.mime, data: character.image.data } },
    ];
    const out = await judge<Record<string, unknown>>(parts, { schema: SCHEMA, temperature: 0 });
    const scores = readScores(out);
    if (!scores) return { failed: "unreadable answer", at };
    return { scores, notes: typeof out.notes === "string" ? out.notes.slice(0, 300) : "", pass: passes(scores), at, model: MODEL };
  } catch (error) {
    console.error("hook eval", row.id, error);
    return { failed: error instanceof Error ? error.message.slice(0, 200) : "error", at };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Cron step: scores up to `limit` generations not scored yet: done, from EVAL_SINCE on, a library hook with a
 * built-in character (the only clips the cache can serve). Returns how many it scored.
 */
export async function evalDue(limit = 2, judge: typeof geminiJSON = geminiJSON): Promise<number> {
  const { data, error } = await db().from("generations").select("id,user_id,input,reference,result")
    .eq("state", "done").is("eval", null).gte("created_at", EVAL_SINCE)
    .eq("input->hook->face->>kind", "character").not("input->>sourceRefId", "is", null)
    // A clip served from the cache is a copy of one already approved: nothing to score.
    .not("task_id", "like", "cache/%")
    .order("created_at").limit(limit);
  if (error) {
    // Migration 0023 not applied yet: nothing to score, not a failing cron.
    if (error.code === "42703" || error.code === "PGRST204") return 0;
    throw error;
  }
  let done = 0;
  for (const row of (data ?? []) as Row[]) {
    const result = await evalGeneration(row, judge);
    // Only if still unscored: two runs never overwrite each other.
    const { error: e } = await db().from("generations").update({ eval: result }).eq("id", row.id).is("eval", null);
    if (e) throw e;
    done++;
  }
  return done;
}

/**
 * The maker's thumbs up or down on the hook now in their video (1, -1, or 0 to clear). Only their own, finished
 * generation whose clip is that one.
 */
export async function rateHook(who: string, runId: string, src: string, rating: number): Promise<boolean> {
  if (![1, -1, 0].includes(rating) || !/^\/api\/media\/[0-9a-f-]{36}\.mp4$/.test(src)) return false;
  const { data, error } = await db().from("generations")
    .update({ rating: rating === 0 ? null : rating, rated_at: rating === 0 ? null : new Date().toISOString() })
    .eq("user_id", who).eq("run_id", runId).eq("state", "done").eq("result->>src", src).select("id");
  if (error) throw error;
  return Boolean(data?.length);
}

/** The maker's saved rating for that clip in their video (1, -1, or 0 when none), so the thumbs show it on reload. */
export async function hookRating(who: string, runId: string, src: string): Promise<number> {
  if (!/^\/api\/media\/[0-9a-f-]{36}\.mp4$/.test(src)) return 0;
  const { data, error } = await db().from("generations").select("rating").eq("user_id", who).eq("run_id", runId).eq("state", "done").eq("result->>src", src).limit(1);
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") return 0;
    throw error;
  }
  const r = (data?.[0] as { rating?: number | null } | undefined)?.rating;
  return r === 1 || r === -1 ? r : 0;
}
