# Codex review request: zero-gap joins and caption-in-clip, 2026-11-07

Founder asked to "double and triple confirm" two things, and to add tests for the edge cases:
1. Clips join with no gap at all, like CapCut's magnet.
2. A caption shows only on the clip it belongs to, 100% of the time.

## What Claude found

A fuzz of 20,000 random timelines (scripts/seamless-checks.cjs) showed 0.3% of captions (415 of 150,807) on one
frame of the neighbouring clip, plus 454 that started one frame late. Cause: the editor (src/lib/edit.ts timeline)
and the export (render/render.mjs plan) add clip lengths in a different order. At an edge like 3.35 s (100.5 frames)
the two sums differ in the last digit (3.3499999999999996 vs 3.35) and round to different frames. Captions were
timed with the editor's numbers and the clips with plan()'s.

A second fault: the export's total was the editor's sum while the picture had plan()'s frame count. They could
differ by one frame, which left up to about 17 ms of silence at the end, or dropped the last frame on the server lane.

Joins themselves were already gap-free: plan() is cumulative. Real renders confirm it, see below.

## Changes

- render/render.mjs
  - `layout(spec)`: plan()'s steps plus each segment's gap and clip frame ranges and its seconds, using plan's own
    order. plan() now returns layout().steps, with identical output.
  - `textFrames(spec, layout, text)`: a caption belongs to the clip or gap its start lies in, with a 1 ms
    tolerance like the preview's `showsAt`. It is clamped to that clip's planned frames. A start or end within
    1 ms of the clip edge snaps to the clip's first or last frame.
  - `planLength(spec)`: plan frames divided by fps.
  - `finalArgs` uses textFrames.
- src/lib/browser-export.ts: the browser lane uses textFrames as well.
- src/app/api/runs/[id]/export/route.ts: spec.total = planLength (the editor sum is still used for limit checks).

## Tests (all mutation-proven)

- scripts/seamless-checks.cjs (14 checks, offline):
  - export joins over 5,000 random timelines;
  - caption frames over 20,000 timelines (about 200k captions): no leak, no late start, no short end;
  - pinned fuzz cases;
  - magnet-on edits over 3,000 runs with 6 random edits each: no space between clips;
  - with the magnet off, space is kept.
- scripts/join-checks.cjs (36 checks): 6 real exports through the server pipeline. Each source has its own colour
  and tone. Checks: frame count, timestamps k/30, the clip on every frame, black frames only where the user left
  space, each caption on exactly its frames, sound length and no silence inside the video.
- Mutations caught:
  - caption plain rounding;
  - millisecond ownership;
  - no end snap;
  - the magnet ignored;
  - a black frame at every join;
  - the editor-sum total.

## Please review brutally

- Is `textFrames` right in every case, including captions in gaps, before 0, past the end, zero-frame clips, and
  overlapping tolerance windows?
- Does the browser lane match the server lane frame for frame?
- Is planLength as the total safe for sounds (`soundPieces`), overlays clamped to total, demoAt and the limits?
- Anything the tests miss? Verdict: ship / block.

## Outcome (Codex, five rounds: block, block, block, block, ship)

1. Black at joins for cuts between two frames; the silence test exempted the joins; a caption on a clip's last
   millisecond vanished. Fixed: held frame, positive gaps only, the editor's `owner` sent with each caption.
2. Black at 120 fps and 2 fps; reverse buffering used 501 MiB on 4K; a caption past the whole frames failed the job
   check. Fixed: countArgs counts three streams (with marker frames), held frame picked by number with
   `select` + `loop` (200 MiB peak), `exportWindow`.
3. At 240 fps the two lanes held different frames. Fixed: the browser holds the first frame inside the cut.
4. Concat timestamp drift over many short pieces (pre-existing; 26 frames on the wrong clip). Fixed: the joined
   video is setpts=N and the sound asetpts=N/SR/TB.
5. Ship. P3 left as is: user-sound delays are rounded to whole milliseconds, and editor placements are saved in
   milliseconds anyway.
