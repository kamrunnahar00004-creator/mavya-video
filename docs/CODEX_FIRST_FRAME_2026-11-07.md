# Codex review request: hook first frame keeps the hook's room, 2026-11-07

The founder's last hook (generation 16d12153: library hook be759e11 with the Summer character) looked bad. Kling
motion control takes only the motion from the clip; the look comes from the first frame Gemini makes. That frame:
- kept Summer's photo bedroom and its golden light instead of the hook's grey room;
- was framed closer;
- added a raised hand that the original's first frame does not have.

Founder: "the Summer room should never leak into it; the room etc. should be the hook's, or as close as possible."

## Change

- New src/lib/server/first-frame.ts, `makeFirstFrame(deps, original, who, outfit)`:
  - A built-in character is sent as a face crop only (ffmpeg crop=iw*0.62:ih*0.40:iw*0.19:ih*0.17), so there is
    no room to copy. Uploaded photos are sent whole, since their framing is unknown.
  - New `swapPrompt`: IMAGE 2 is identity only, and its room, light, clothes and distance are ignored. The room,
    light, framing, pose, hands ("no hand if IMAGE 1 shows none") and expression come from IMAGE 1.
  - A judge (geminiJSON with VERDICT_SCHEMA, temperature 0) compares the edit with the original on six checks:
    room, light, framing, hands, expression and person.
  - On failure it retries with the problem named, up to MAX_TRIES = 3, but not after RETRY_UNTIL_MS = 100 s (the
    210 s hook budget still has to start Kling). The best-scoring frame is kept.
  - If the judge errors, the frame is kept.
- hookgen.ts uses it. `swapFirstFrame` is gone (geminiImage + faceCrop instead). Kling models and prompts are
  unchanged.
- Tests:
  - scripts/first-frame-checks.cjs: 16 checks, offline, in npm test. Mutations caught: full photo sent, no retry,
    old prompt.
  - budget-checks: the prompt freeze now excludes only the swap function.
  - check-module: resolves @/lib/server/first-frame.
- Live run of the real Gemini steps on the failing case: one try, 21 s. All six checks passed, and the frame
  visually matches the hook's room, light and framing with no extra hand, and shows Summer.
- Data: generation 16d12153 now has a note, so reuseHook (which needs note is null) never serves it again. The
  founder's run still uses its file.

## Please review brutally

- Correctness and safety of makeFirstFrame: tries, best-frame choice, judge failure, the time budget, cost.
- Is the face crop safe for every built-in character (public/characters/*.jpg, 768x1376)?
- Prompt-injection or abuse risk from user photos?
- Pre-existing and not touched: scripts/generation-checks.cjs fails on an unstubbed @/lib/client (it fails before
  this change too).

Verdict: ship or block.

## Round 3: founder changes (after rounds 1 and 2)

- **No crop.** The founder ruled that the body must be the character's. A face crop would put Summer's face on the
  hook person's body, and the result wouldn't be consistent. The whole photo is sent as IMAGE 2. The prompt takes
  ONLY the person from it (face, hair, skin tone, body shape, build, proportions) and nothing else (room, background,
  walls, furniture, lighting, colours, clothes, pose, camera distance). The clothes come from the hook (outfitFor).
- **Camera angle** (founder: it didn't match). The prompt asks for the same camera height, side and tilt, and a new
  judge check, sameAngle, enforces it.
- **Weighted scores.** When no try passes, a frame with the hook's room and light always wins (room 10, light 5,
  others 1).
- **One fixed deadline (round 2, P1).** Every image and every judge call is cut to what's left of FRAME_BUDGET_MS =
  170 s. The first try is min(150 s, left - 15 s), and the judge gets min(15 s, left). If there's no time before the
  first try, it throws FrameOutOfTime; if there's no time for a judge, the frame is kept.
- **Live test**, real code, 3 runs on the failing hook:
  - 7 of 8 tries kept the hook's room. The one leak was caught and retried.
  - One run passed all checks on its 3rd try. The others kept their best frame: the hook's room and light, with
    the angle and expression close.
  - About 70 s and 3 image calls per run.
- first-frame-checks: 25 checks. New mutations caught: uncapped judge, full first-try time, body dropped from the
  prompt, equal weights.

## Outcome

Codex: block, block, block (tie in the scores), then ship. Weights are room 12, light 6, others 1. first-frame-checks: 26.

## Rounds 5-7

- Eyes: a sameGaze check, plus a Kling eyes sentence. Face: a Kling sentence asking for the same expression intensity.
- Caption removal (CLEAN_PROMPT) runs before the swap. The judge compares with the TRUE original, ignoring the caption area.
- JUDGE_MS is 30 s: the real check takes 12-13 s, and at 15 s it timed out and the frame went unchecked.
- Codex: ship. A live test still leaked the room on this hook in 3 of 3 tries; the next step is plain-backdrop character photos.
