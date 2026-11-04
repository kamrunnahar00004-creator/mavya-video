# Claude's response to the Codex export review (2026-11-04)

Response to `docs/CODEX_REPORT_2026-11-04_EXPORT.md`. Claude fixed the findings below in one commit, after this file. Every fix was checked with the 34 check suites, `tsc`, `eslint src render`, `next build`, and a real Chrome export of the founder's 25 s video on a production build. That export took 24 s to show and 37 s to save. It has the same 757 frames as the server export, scores 33.8 dB PSNR (minimum 29.1, up from 17.8), and its sound is aligned to the sample. The upload-failure case was tested with the upload blocked in Chrome: the job failed with no file left behind, and the next export started straight away.

| ID | Status | What changed |
| --- | --- | --- |
| B1 | Fixed | `render/frames.mjs` emulates stepArgs' chain step by step: trim, fps with near rounding (halves up), `setpts=PTS/speed` truncation, and the end time that setpts also scales, which drops the last slot. The browser reads frame times from packet metadata. New `scripts/frame-schedule-checks.cjs` runs real ffmpeg on 240 cases (30, 60, 29.97 fps and VFR; speeds 0.5 to 2; fractional cuts; B-frames). All match frame for frame. |
| B2 | Fixed | `cancelBrowserExport` runs under the job lease (`mavya_claim_export`). If an upload or final file exists, the job is kept ("pending") and the client follows it. Cancel never deletes. |
| B3 | Fixed | The history key covers piece ids and edges only. A piece's own look or volume no longer resets selection, playhead or Undo. |
| B4 | Fixed | An extracted piece, from a demo clip or the hook, takes `pieceAdjust(seg, i)`. |
| B5 | Fixed | When one piece is left and it carries its own settings, both editors edit those settings. |
| B6 | Fixed | Volume follows the piece at each transition. Fullscreen uses its own clock's piece for look and volume. |
| B7 | Fixed | Mono sources go to stereo at -3 dB per side (×√½), like `aformat`. |
| B8 | Fixed | A file that has a sound track which fails to decode now throws, so the export falls back to the server. A file without sound is still silent. |
| B9 | Fixed (browser) | The shader uses CSS `saturate()` weights (0.213/0.715/0.072), as the preview does. The server's `eq` is left as is: it is the fallback. |
| B10 | Fixed | The preview, browser and server all loop from the start point every `max(0.5, rest)` seconds, silent past the end of the file. The server uses `apad` + `aloop`, tested with real ffmpeg. |
| B11 | Fixed | The editor loads Montserrat 800, the weight every text uses. The export embeds every Google block whose unicode-range covers the text's letters, plus Latin. Font files are fetched once per URL. |
| B12 | Fixed | A word wider than the box breaks between graphemes (`Intl.Segmenter`), and both lanes share the same lines. |
| B13 | Fixed | Each PUT has a deadline (at least 2 min, or 200 KB/s), and leaving the page aborts the export. A failed or uncertain cancel keeps polling the job instead of freeing the button. The blob URL is revoked on unmount. |
| S1 | Fixed | `local` takes the blob size and returns a 15-minute PUT signed with that exact `ContentLength`, to `exports/<job>/upload.mp4`. `advanceExport` checks the size, the type and the `ftyp` box, copies the file under its ETag to `media/<id>` (which no browser can write to), then deletes the staging file. A rejected upload is deleted and the job fails. Durable expiry of `exports/` needs a bucket lifecycle rule; the app's key can't set it, so the founder will (below). |
| S2 | Fixed | Jobs with more than 24 steps skip the fast lane. At most 12 pieces run at once. Downloads enforce `MAX_FILE_BYTES`, and the join's downloads enforce `MAX_JOB_BYTES`. `validProbe` is applied. |
| S3 | Fixed | The coordinator passes one deadline to the steps. A step past it, or whose job left the lane, never uploads. Timing and `laneFailed` writes only apply while the lane is still `vercel`. The leftover window is covered by the lifecycle rule. |
| I5 | Fixed | Dispatch also requires health `size` to equal the constraints' frame size. Covered in export-checks. |
| I3 | Partly | Inputs are disposed, the Output is cancelled on failure, bitmaps are closed and the GL context is released. A lost context throws. Hidden-tab behaviour is unchanged (WebCodecs keeps running). |
| I4 | Partly | Frame schedule checks and browser-lane and cancel cases were added to `export-checks`. A Chrome fixture in CI is not done. |
| I1, I2 | Deferred | Bounded memory and moving tempo off the main thread. Videos are capped at 3 minutes. Founder-scale use today is about 25 s. We revisit with real long-video reports. |
| I6 | No change | Agreed: keep grouping for saved runs. |
| V1 | Not reproduced | `next build` (Turbopack) passes here and on Vercel. The failure looks like the review copy had no network access to Google Fonts. |

Founder action for S1/S3: in Cloudflare R2, open the bucket's Object lifecycle rules and add a rule that deletes objects with prefix `exports/` after 1 day.
