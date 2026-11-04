# Codex: review of Claude's fixes for your export report (2026-11-04)

You reviewed `7afb5c5..6dc5073` and wrote `docs/CODEX_REPORT_2026-11-04_EXPORT.md`. Claude then changed the code. Review those changes now:

- `de323bd` "Fix the Codex export review findings": the main commit.
- `769bf3f` "Connect Microsoft Clarity session recordings": outside your last review, so review it too.
- Claude's own account of each finding is in `docs/CLAUDE_RESPONSE_2026-11-04_EXPORT.md`. Check every claim in it. Do not take any of them as true.

`git diff 6dc5073..de323bd` shows everything since your review. All of it is live on mavya.app, and the Render worker runs `de323bd`. The founder has added an R2 lifecycle rule that deletes `exports/` objects after 1 day.

**Report only. Do not change code, do not commit, do not push.** Write `docs/CODEX_REPORT_2026-11-04_FIXES.md`.

## What to check

1. **Was each finding (B1 to B13, S1 to S3, I3 to I5) really fixed?** Confirm or refute each with evidence, the same way you reproduced it before. Re-run your probes in `/tmp/mavya-export-review-2Hfrpf/probe` against the new code.
2. **Did the fixes break anything or add new bugs?** In particular:
   - `render/frames.mjs` (frame schedule) and `scripts/frame-schedule-checks.cjs`.
     - Cases the 240-case check misses: keyframed zoom (zoompan's own timing), very short pieces, pieces with no frame in range, cuts at the file's end, sources whose first timestamp is not 0, rotated originals, HEVC.
     - In `src/lib/browser-export.ts`, the frame times come from packet metadata (`EncodedPacketSink`, decode order, stopping 1 s past the cut). Can that miss frames?
   - Upload staging:
     - `local` mode in `src/app/api/runs/[id]/export/route.ts` (size-bound 15-minute PUT to `exports/<job>/upload.mp4`).
     - `promoteUpload` and `cancelBrowserExport` in `src/lib/server/export-jobs.ts` (lease, size, MIME, `ftyp` check, ETag copy, deletion), `objectStart` in `src/lib/server/r2.ts`.
     - Races between upload, promotion, cancel, polling and account deletion. Can a user still overwrite or keep any file they shouldn't? Is anything orphaned outside `exports/`?
   - Fast lane in `src/lib/server/fast-export.ts`.
     - FAST_MAX_STEPS 24, concurrency 12, the 170 s shared deadline passed to steps, byte budgets via the TransformStream, `validProbe` parsing.
     - The lane-guarded payload writes (`.eq("payload->>lane","vercel")`).
     - The worker frame-size check in `advanceExport`.
   - Editor in `src/components/editor-tools.tsx` and `src/lib/edit.ts`:
     - history key on piece edges only;
     - the lone-piece override path;
     - volume at piece transitions;
     - fullscreen `fullShown`;
     - extracted pieces taking `pieceAdjust`.
   - Sound:
     - mono at ×√½;
     - `decodeSound` throwing on a failed decode (could it now reject files that used to work, for example library sounds that mediabunny can't parse?);
     - the new loop rule `max(0.5, rest)` in the preview, the browser and the server (`apad` + `aloop` in `render/render.mjs`).
   - Text:
     - Montserrat 800 added to the editor;
     - `text-png.ts` choosing font blocks by unicode-range, with per-text face caching and per-URL file caching;
     - `text-lines.ts` grapheme breaking for overlong words.
   - `export-button.tsx`: the abort controller lifetime, PUT deadlines, cancel replies, blob URL revocation, and what the user sees in each failure case.
   - Clarity: script loading and privacy wording. The founder wants recordings to include what users type in the app, to see and fix their bugs, so typed text is meant to be recorded. Only check that sign-in and password fields stay masked (`data-clarity-mask` on the auth and reset-password forms, including the show-password toggle) and that the privacy page says what is recorded.
3. **Anything else you find** in the touched files.

## How to test

- Run every `scripts/*-checks.cjs` and `scripts/verify-*.cjs`. Run `npx tsc --noEmit` and `npx eslint src render`.
- `scripts/frame-schedule-checks.cjs` needs `node_modules/ffmpeg-static`.
- For a real Chrome run, use the temporary-user flow described in the earlier request. Delete every account and file you create. Never write to the founder's account or real customer data.

## Report format

Same as before:

1. A summary table (id, area, severity, one line).
2. Each finding with file and line, a concrete failing scenario, how sure you are, and the fix you suggest.
3. For each earlier finding, a verdict: fixed, partly fixed, or not fixed.
4. What you verified as correct, and how.
