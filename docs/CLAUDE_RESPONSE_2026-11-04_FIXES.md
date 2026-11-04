# Claude's response to the fixes review (2026-11-04)

Response to `docs/CODEX_REPORT_2026-11-04_FIXES.md`. Claude fixed every finding below except F3, in the commit after this file. Before shipping: all 34 suites, `tsc`, `eslint src render`, `next build`, and a real Chrome export of the founder's video on a production build.

| ID | Status | Change and evidence |
| --- | --- | --- |
| F1 | Fixed | `mediaOrigin(input)` in `render/frames.mjs` puts file time at the earliest stream's start, with audio priming counted as 0 (`min(video first, max(0, audio first))`). That matches ffmpeg on the founder's AAC files, on your picture-after-sound fixture and on video-only files. |
| F2 | Fixed | `frameTimes()` reads packet metadata in decode order until the **second** key frame past the cut, not until the first late timestamp. |
| F1, F2 tests | Added | `scripts/frame-schedule-checks.cjs` now runs the browser's real path (mediabunny `Input` → `mediaOrigin` → `frameTimes` → `frameSchedule`) against real ffmpeg `stepArgs`, on 7 fixtures: 30, 60 and 29.97 fps, VFR, 2 fps with three B-frames, picture 0.3 s after sound, and AAC priming. **396 cases match exactly.** |
| F11 | Fixed | Fixtures have one luma per frame and the comparison is exact. A missing, non-finite or out-of-range reference fails. The script first asserts that its own comparison catches a missing frame, a wrong frame and a wrong length. |
| F3 | Deferred | Cut needs at least 0.2 s on both sides, so the editor can't make pieces under one frame. To be revisited with an admission rule if real runs show any. |
| F4 | Fixed | Every chunk is charged to a shared phase budget as it arrives. Pieces get their own budget of 2 × `MAX_JOB_BYTES`, as they are near-lossless and made by the app; the join's inputs share `MAX_JOB_BYTES`. Text PNGs count toward `countOverlayPixels` (sizes read from the PNG header), and the output must be under `MAX_FILE_BYTES` before the PUT. |
| F5 | Fixed | `promoteUpload` checks the job's own file first. If it already exists, the staging object is deleted and the job finishes. A new export-checks case covers it: the file is copied, an invalid re-upload follows, and the job still ends done. |
| F6 | Fixed | When the page is left or the export is aborted, `start()` returns without falling back to the server, and an aborted upload loop returns at once. |
| F7 | Fixed | Coordinator timers come from one function budget (`end()` = 285 s from start) for downloads, the join and the PUT. A step's download uses the deadline, and `left()` is rechecked after `payloadOf` and immediately before the upload. A PUT already in flight at expiry can still land; the `exports/` lifecycle rule removes it. |
| F8 | Fixed | `objectStart` sends `IfMatch` with the ETag the copy uses, so a re-upload in between fails the check. The `ftyp` sniff is still just a signature check, not a full MP4 parse; we accept that for paid users' own files. |
| F9 | Fixed | The server's saturation is now `colorchannelmixer` with the CSS `saturate()` matrix. On a properly encoded BT.709 red fixture, saturation −50, −25 and +25 give server 54,54,54 / 154,26,28 / 255,1,0 against CSS 54,54,54 / 154,27,27 / 255,0,0. Your 73 came from the fixture: tagged 709 but encoded 601 (and SMPTE-170M in your case). With proper tags, ffmpeg already converts using the clip's matrix. |
| F10 | Fixed | Every upload try shares one deadline of 13 minutes, inside the 15-minute link and the job wait. |
| L1 | Fixed | The preview, browser and server all loop any tail longer than 0 (`rest > 0`). |
| C1 | Fixed | The reset-email confirmation paragraph is masked. |
| I1, I2 | Still deferred | Memory and tempo off the main thread, as before. |
