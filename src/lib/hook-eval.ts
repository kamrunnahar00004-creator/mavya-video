// Hook eval (founder 2026-11-26): what a generated hook is scored on, and when it passes. Shared by the background
// eval (src/lib/server/hook-eval.ts), its checks and the shortlist script.

/** Each 0 to 10, 10 best. */
export const CRITERIA = {
  face: "The person's face and hair match the character photo (same person, not a look-alike).",
  motion: "The person does what the person in the original hook does: the same reaction, gestures, head turns and timing.",
  clean: "No broken hands or fingers, melting or flickering face, extra people, warped background or objects.",
  noText: "No text, captions, logos or watermarks in the video.",
} as const;
export type Criterion = keyof typeof CRITERIA;
export type HookEval = { scores: Record<Criterion, number>; notes: string; pass: boolean; at: string; model: string } | { failed: string; at: string };

/** Every score at least this. A clip only enters the cache after the founder also confirms it. */
export const PASS_MIN = 7;

/** Generations from this time on are scored (founder: "from now on", no back-scoring of old clips). */
export const EVAL_SINCE = "2026-11-26T00:00:00Z";

/** The scores read from the model, clamped to whole numbers 0 to 10; null when any is missing. */
export function readScores(raw: unknown): Record<Criterion, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const out = {} as Record<Criterion, number>;
  for (const k of Object.keys(CRITERIA) as Criterion[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[k] = Math.max(0, Math.min(10, Math.round(v)));
  }
  return out;
}

export const passes = (scores: Record<Criterion, number>) => (Object.keys(CRITERIA) as Criterion[]).every((k) => scores[k] >= PASS_MIN);

/** Shortlisted for the founder: passed the eval and its maker gave it a thumbs up. */
export const shortlisted = (row: { eval?: HookEval | null; rating?: number | null }) => Boolean(row.eval && "pass" in row.eval && row.eval.pass && row.rating === 1);
