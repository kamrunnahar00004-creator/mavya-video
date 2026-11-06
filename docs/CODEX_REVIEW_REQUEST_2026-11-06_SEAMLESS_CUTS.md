# Codex: brutally verify seamless cuts between clips (2026-11-06)

The founder wants clips to join with **zero gap**, like CapCut's magnet: no black frame, no frozen frame, no silent sound gap, not even 0.00001 s. Verify that this is true in the exported video, and review Claude's fix.

**Review and verify only. Do not commit or push.** Write findings to `docs/CODEX_REVIEW_2026-11-06_SEAMLESS_CUTS.md`. If you find a defect, say exactly where, prove it with a measurement, and propose the smallest fix.

## What Claude measured

The founder's newest production export (job `70ae9862-b1d9-4932-829a-2b9fdaf684b6`, `media/cfcd45ca-dfdc-4834-8b0c-56c3f67c6fa2.mp4`, browser lane, 7 clips, 15.2 s, 30 fps). The cuts land at frames 55, 142, 229, 275, 327, 395 and 456 (cumulative `plan()` in `render/render.mjs`).

- 456 of 456 frames are present. No black frame: the darkest frame has a mean Y of 91. Each cut is a single-frame jump in the frame-to-frame difference.
- The sound has no silence at the cuts. The only silent stretch of 5 ms or more is the first 9.3 ms of the file, and the music file itself starts with 17 ms of silence.
- **Defect:** every clip with a speed change (1.15, 1.1, 1.15) ended on a held frame. Its last source frame was repeated for 1 frame before the cuts at 142 and 229, and for 2 frames before the cut at 395. The other clips had none.

Cause: each piece was trimmed exactly at its `end`. After `setpts=PTS/speed`, the source frames that survive number `trunc(slots / speed)`. That is 1 to 2 frames fewer than the planned length, which is the cumulative rounding of `(end - start) / speed`. `tpad=stop_mode=clone` (server) and `frameSchedule`'s `stop` (browser) then repeat the last frame. The browser lane copies the server's frame choice on purpose (`render/frames.mjs`).

## The fix (uncommitted, `git diff`)

- `render/render.mjs` `plan()`: each piece step gets `readEnd = end + 3 * speed / fps`. `stepArgs` trims video and sound to `readEnd`, and the existing `trim=duration=len` / `atrim=duration=len` still cut the step to its planned length. Extra source frames now fill the length; the last frame is cloned only when the source file truly ends.
- `src/lib/browser-export.ts`: the browser reads frames (`frameTimes`, `frameSchedule`) and sound (`b`) to `readEnd`, so both lanes still pick the same frames.
- `render/render.d.mts`: `Step.readEnd`.
- `scripts/frame-schedule-checks.cjs`:
  - uses `readEnd`;
  - adds a HELD FRAME check: at speed 1 or more, on a source of 30 fps or more that has frames left after the cut, no output frame may reuse the previous output's source frame.
  - Before the fix, 79 of 396 cases failed. After it, 396 of 396 pass, and still match ffmpeg frame for frame.

Real Chrome export after the fix: the same job spec, rendered with the browser bundle from the working tree (Windows harness, `C:\Users\farha\AppData\Local\Temp\mavya-enc\gaps_fixed.mp4`, encoder `hw-qp20`). Results:
- 456 of 456 frames;
- no near-duplicate frames (every frame-to-frame difference is at least 0.5);
- no black frames;
- a single-frame jump at every cut;
- no silent stretch except the music file's own start.

## Check brutally

1. Reproduce the before and after numbers. Run `node scripts/frame-schedule-checks.cjs`. Confirm that the HELD FRAME check is sound, with no false passes and no false failures.
2. Are there other ways to get a gap, a black frame or a frozen frame at a join? Check all of these:
   - `seg.gap` (when the editor creates it, `src/lib/edit.ts`);
   - pieces shorter than one frame (`count <= 0` is skipped);
   - Cut pieces of the same clip;
   - `schedule.source === -1` drawing black;
   - the first frame of a clip whose first decodable frame is after `start`;
   - VFR iPhone files;
   - 60 fps sources;
   - speed below 1;
   - a piece whose `end` is the end of the file;
   - the hook-to-demo join;
   - `demoAt` / the demo copy-out key frame.
3. Sound at joins:
   - Does the clip's own sound now fill its planned length in both lanes (browser `mixSound`: `tempo` of `[a, b]` vs `n`; server: `atrim` to `readEnd`, `atempo`, `apad`, `atrim=duration`)?
   - Are there clicks or overlaps?
   - Measure a sped-up clip **with its sound on** (volume > 0). The founder's job had clip sound off except the hook.
4. Does reading up to 3 frames past `end` ever show frames the user cut out?
   - Look at the length the editor preview shows (`src/lib/edit.ts`, `run-preview.tsx`) compared with the export's planned length.
   - Any visible content the user removed is a defect.
5. Server lane (`render/render.mjs`, deployed to Render after push): confirm that the `stepArgs` change is correct and that the server frame-schedule check passes.
6. TypeScript: `npx tsc --noEmit -p .`. The lint errors in `scripts/frame-schedule-checks.cjs` (`require`) pre-date this change.

Report in plain English: a verdict (seamless or not), a table of findings with evidence, and any fix.
