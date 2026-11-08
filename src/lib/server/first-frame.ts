/**
 * The hook's first frame with the new person in it (founder 2026-11-07: "the Summer room should never leak into it;
 * the room etc. should be the hook's"). Kling takes only the MOTION from the original clip: the person, room, light and
 * framing all come from this frame, so it must be the original frame with only the person swapped.
 *
 * Found 2026-11-07: Gemini kept the character photo's bedroom and golden light, framed her closer and added a hand the
 * original did not have; Kling then animated that. Now:
 *  1. The character's whole photo is sent, so their body (build, shape, proportions) stays theirs and every video of
 *     them looks the same (founder 2026-11-07: a face crop would take the hook person's body, a man's body under a
 *     woman's face). The prompt takes ONLY the person from it: nothing of its room, light, clothes, pose or framing.
 *  2. Each frame is checked against the original (room, light, framing, hands, expression, identity) and made again,
 *     told what was wrong, up to MAX_TRIES while time allows. The best one is kept.
 *  3. Never the wrong person (founder 2026-11-08): a test run's three frames all kept the original creator ("the
 *     person from IMAGE 2 was not applied"), the best was kept anyway, and Kling animated the creator's real face. A
 *     frame the check says is not the character never goes to Kling: a checked frame of the character always beats
 *     one without; when no try has the character, ONE extra try is made (only then, so a normal hook takes no longer),
 *     and if that fails too the hook fails with WrongPerson (refunded, no fallback) instead.
 * The steps are injected (deps) so the logic is tested without calling Gemini.
 */

export type Who = { image: { data: string; mime: string } | null; words: string };
export type Verdict = { sameRoom: boolean; sameLight: boolean; sameFraming: boolean; sameAngle: boolean; sameHands: boolean; sameExpression: boolean; samePerson: boolean; problem: string };
export type FrameDeps = {
  /** Gemini image: the parts in, the image out, within `ms` milliseconds. */
  image: (parts: unknown[], ms: number) => Promise<Buffer>;
  /** Gemini judge: the parts in, a verdict out, within `ms` milliseconds. */
  judge: (parts: unknown[], ms: number) => Promise<Verdict>;
  /** Milliseconds since the hook started; retries stop when time runs short. */
  elapsed: () => number;
};

export const MAX_TRIES = 3;
/** The one extra try made only when no try so far has the character in it. */
export const PERSON_TRIES = MAX_TRIES + 1;
/** What the customer sees when the character could not be put in the frame. */
export const WRONG_PERSON_MESSAGE = "We couldn't put your character into this hook. Try again or choose another hook.";
/**
 * The first frame's whole deadline, counted from the hook's start (deps.elapsed): every image and every check is cut to
 * what is left of it, so sharing the files and starting Kling (about 30 s) always fit in the hook's 210 s budget
 * (withWorkBudget). Codex 2026-11-07: per-call limits alone ran past it (a first try started late got its full time; a
 * retry's check ran on after the retry).
 */
export const FRAME_BUDGET_MS = 170_000;
/** The longest one image may take, when there is time. */
export const FIRST_TRY_MS = 150_000;
/** The longest one check may take; also the time kept back for it when an image starts. */
// 30 s: one check with three pictures and seven questions takes 5-15 s (measured 2026-11-07); at 15 s it timed out and
// the frame went to Kling unchecked.
export const JUDGE_MS = 30_000;
/** A retry starts only with this much left: an image (about 20 s) and its check, with room to spare. */
export const RETRY_MIN_MS = 60_000;
/** Below this, no check is started: the frame is kept as it is. */
const MIN_CALL_MS = 3_000;
export class FrameOutOfTime extends Error {}
/** No frame the check accepted as the character: the hook must fail, never go to Kling with someone else's face. */
export class WrongPerson extends Error { constructor() { super(WRONG_PERSON_MESSAGE); } }

const CHECKS = ["sameRoom", "sameLight", "sameFraming", "sameAngle", "sameHands", "sameExpression", "samePerson"] as const;

export const VERDICT_SCHEMA = {
  type: "OBJECT",
  properties: Object.fromEntries([...CHECKS.map((k) => [k, { type: "BOOLEAN" }]), ["problem", { type: "STRING" }]]),
  required: [...CHECKS, "problem"],
};

/** The swap instruction. `fix`: what was wrong with the last try. */
export function swapPrompt(who: Who, outfit: string, fix = ""): string {
  const person = who.image ? "the person in IMAGE 2" : `a person (${who.words})`;
  const identity = who.image
    ? "From IMAGE 2 take ONLY the person themselves: their face, hair, skin tone, body shape, build and proportions. Take NOTHING else from IMAGE 2: not its room, background, walls, furniture, lighting, colors, clothes, pose or camera distance. "
    : "";
  return (
    `Edit IMAGE 1: replace only the person in it with ${person}, wearing ${outfit}. ${identity}` +
    "The result must look exactly like IMAGE 1 with only the person swapped: the same room, walls and everything behind them, the same light (color, brightness and direction), the same camera distance and framing (the head the same size and in the same place as in IMAGE 1), the same camera angle (the phone just as high or low, as far to the side, and tilted the same way, so the face is seen from the same direction as in IMAGE 1, not straight on unless IMAGE 1 is), " +
    "the same pose, head angle and gaze, the same hands in the same places (if no hand is visible in IMAGE 1, no hand in the result), every object they hold with the same shape, size and material, the same facial expression at the same strength (mouth open or closed exactly as in IMAGE 1, no bigger smile or surprise). " +
    "Their hands have natural, unpolished nails and no rings. Remove all on-screen text and captions. Photorealistic phone selfie." +
    (fix ? ` The last try was wrong: ${fix.slice(0, 300)}. Fix that.` : "")
  );
}

/** The check. A described person (no photo) is judged against their description (Codex 2026-11-07: it had nothing). */
export function judgePrompt(who: Who): string {
  const target = who.image ? "the person in IMAGE 2 (only the person: their face, hair and body)" : `a person matching this description: ${who.words.slice(0, 300)}`;
  const person = who.image ? "the face, hair and body (build, shape) are clearly the person in IMAGE 2" : "the person matches the description";
  return (
    `IMAGE 1 is the original frame. IMAGE 3 is supposed to be IMAGE 1 with only the person replaced by ${target}. Check IMAGE 3 against IMAGE 1, strictly: ` +
    `sameRoom: the same room, walls and background${who.image ? ", nothing from IMAGE 2's surroundings" : ""}; sameLight: the same light color, brightness and direction; sameFraming: the same camera distance, head size and position; sameAngle: the same camera angle (seen from the same height, side and tilt, the head turned and tilted the same way); ` +
    `sameHands: hands in the same places (no hand that IMAGE 1 does not show); sameExpression: the same expression at the same strength; samePerson: ${person}. ` +
    "problem: one short sentence on what is wrong, or empty if nothing."
  );
}

/**
 * How close a frame is. The hook's room and light matter most (founder 2026-11-07: the character's room must never leak
 * in), so when no try passes, a frame with the hook's room and light always wins over one without, whatever else.
 */
// Room outweighs light and the five small checks together (12 > 6 + 5); light outweighs the five (6 > 5), so no tie
// ever keeps a wrong-room or wrong-light frame over a right one (Codex 2026-11-07: 10 and 5 tied).
const WEIGHT: Record<(typeof CHECKS)[number], number> = { sameRoom: 12, sameLight: 6, sameFraming: 1, sameAngle: 1, sameHands: 1, sameExpression: 1, samePerson: 1 };
const score = (v: Verdict) => CHECKS.reduce((t, k) => t + (v[k] ? WEIGHT[k] : 0), 0);
export const passes = (v: Verdict) => CHECKS.every((k) => v[k]);

/** The first frame for Kling: made, checked, and made again with the problem named, keeping the best. */
export async function makeFirstFrame(deps: FrameDeps, original: Buffer, who: Who, outfit: string): Promise<{ frame: Buffer; tries: number; verdict: Verdict | null }> {
  const scene = { inline_data: { mime_type: "image/jpeg", data: original.toString("base64") } };
  const person = who.image ? [{ text: "IMAGE 2 (the new person: face, hair and body only):" }, { inline_data: { mime_type: who.image.mime, data: who.image.data } }] : [];
  let best: { frame: Buffer; verdict: Verdict | null; score: number } | null = null;
  let fix = "", tries = 0;
  // A checked frame of someone else is never sent on (founder 2026-11-08).
  const done = () => {
    if (best!.verdict && !best!.verdict.samePerson) throw new WrongPerson();
    return { frame: best!.frame, tries, verdict: best!.verdict };
  };
  // The character first, then the closest: a frame with the character beats any frame without.
  const rank = (v: Verdict) => (v.samePerson ? 1000 : 0) + score(v);
  const left = () => FRAME_BUDGET_MS - deps.elapsed();
  // MAX_TRIES, plus one only when no try has had the character yet.
  const limit = () => (best?.verdict?.samePerson ? MAX_TRIES : PERSON_TRIES);
  while (tries < limit()) {
    if (best && left() < RETRY_MIN_MS) break;
    const imageMs = Math.min(FIRST_TRY_MS, left() - JUDGE_MS);
    if (imageMs < MIN_CALL_MS) {
      if (best) break;
      throw new FrameOutOfTime("No time left to make the first frame");
    }
    tries++;
    let frame: Buffer;
    try {
      frame = await deps.image([{ text: "IMAGE 1 (the scene):" }, scene, ...person, { text: swapPrompt(who, outfit, fix) }], imageMs);
    } catch (error) {
      // A failed retry keeps the frame already made (Codex 2026-11-07: it threw it away); a failed first try fails.
      if (best) return done();
      throw error;
    }
    const judgeMs = Math.min(JUDGE_MS, left());
    let verdict: Verdict | null = null;
    try {
      if (judgeMs < MIN_CALL_MS) throw new FrameOutOfTime("No time left to check the frame");
      verdict = await deps.judge([{ text: "IMAGE 1 (the original):" }, scene, ...person, { text: "IMAGE 3 (the edit):" }, { inline_data: { mime_type: "image/jpeg", data: frame.toString("base64") } }, { text: judgePrompt(who) }], judgeMs);
    } catch {
      // The check is a safeguard: when it fails or there is no time for it, the best frame so far is kept if it has
      // the character; otherwise this unchecked frame (not known to be wrong) is kept rather than a known wrong one.
      return best && best.score > 0 && best.verdict?.samePerson ? done() : { frame, tries, verdict: null };
    }
    const s = rank(verdict);
    if (!best || s > best.score) best = { frame, verdict, score: s };
    if (passes(verdict)) break;
    fix = verdict.problem || CHECKS.filter((k) => !verdict![k]).join(", ");
    // Past MAX_TRIES only the person matters: the extra try is told so.
    if (tries >= MAX_TRIES && !best.verdict?.samePerson) fix = `the person is not the person in IMAGE 2 (or the description); put exactly that person in. ${fix}`;
  }
  return done();
}
