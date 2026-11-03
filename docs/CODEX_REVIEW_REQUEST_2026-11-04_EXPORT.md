# Codex: review of the editor and export work since 7afb5c5 (2026-11-04)

Mavya (mavya.app) is a hook + demo short-form video SaaS: Next.js 16 on Vercel Pro (iad1), Supabase, media in Cloudflare R2, a Render.com export worker (`render/`, 0.5 CPU, 512 MB). Real strangers are signing up now.

Since your last agreed fixes (7afb5c5), Claude shipped 30 commits to main, `7afb5c5..HEAD`, all live. They cover the editor preview, Cut, preview copies of uploads, and the export, which went from 4 to 6 minutes on the worker to about 23 s in the browser. Review all of it.

**Report only. Do not change code, do not commit, do not push.** The flow: you report, Claude reviews and decides, and you fix only the list we agree on afterwards. Write the report to `docs/CODEX_REPORT_2026-11-04_EXPORT.md`.

## What to report

For every finding give file and line, a concrete failing scenario (inputs, state, what goes wrong), severity (critical / high / medium / low), how sure you are, and the fix you would make. Separate:

1. **Bugs and logic errors** (correctness, races, crashes, wrong output).
2. **Security and abuse** (auth, signed links, internal routes, billing bypass, cost abuse).
3. **Improvements** (speed, simplicity, robustness), each with the expected gain. Measure where you can: numbers from a real browser or a production build beat opinions.
4. **Things you checked and found correct**, briefly, so we know what was covered.

Claude's evidence below is a claim to check, not a fact to trust.

## The work, by area

### 1. Browser export (78d56c0 and the follow-up fix, the main thing to review)

Founder's requirements: export at 1080x1920 in well under a minute, and the exported video must match what the user saw in the editor preview, 100%.

- `src/lib/browser-export.ts` (new, uses `mediabunny` 1.61.6): Chrome/Edge only (`browserExportSupported`: userAgentData brands, WebCodecs, WebGL2, H.264 and AAC encoders). Renders the server's job spec in the browser: decode with WebCodecs, draw each frame with WebGL (look shader mirrors `look()` in `render/render.mjs`), lay text PNGs (from `src/lib/text-png.ts`) on the same frames as `finalArgs`, mix sound (sum like `amix normalize=0`, WSOLA `tempo()` in place of `atempo`, looping sounds like `aloop`), encode H.264 10 Mbps + AAC 160k, MP4 with fast start, then relabel the `colr` box to BT.709 (`bt709()`).
- Frame choice was measured against ffmpeg output rather than derived: the video track's own first timestamp (not the input's earliest stream, since the AAC priming made it 21 ms off), the first frame at or after each cut (`p0`), slot `k` at speed 1, otherwise slot `floor(k*speed)+1`. Is that speed rule right in general (other speeds, 60 fps or variable frame rate phone clips, B-frames, clips without a working copy)?
- `src/components/export-button.tsx`: `exportInBrowser` calls POST `/api/runs/[id]/export` with `mode:"sources"` (spec), renders, shows the blob in the dialog at once, then `mode:"local"` (reserves the job, returns the R2 upload link) and PUTs the file; polling finishes the job. If the upload fails three times it calls `mode:"cancel"`, which marks the job failed and removes any file, so Export is free again. Any error before the reserve falls back to the server export.
- `src/app/api/runs/[id]/export/route.ts`: the `sources` / `local` / `cancel` modes; file links are now built in parallel. Check that the modes cannot bypass billing or limits, leak another user's links, or leave orphaned files or jobs. `sources` returns 6-hour signed GET links for the user's own files.
- `src/lib/server/export-jobs.ts`: lane `"browser"` waits up to 15 minutes for the upload, then fails. The upload lands at `media/<media_id>`; the existing check then registers it (size, mime) and appends it to My files. Can a user PUT something other than their export there (any size up to 300 MB, any content)? Does it matter?
- Evidence (local production build and live, headless Windows Chrome without a GPU, founder's 25 s / 10 clip / 15 text video): live video shown 23 s, in My files 29.5 s. Same 757 frames as the server export, PSNR 33 dB average, sound aligned to the sample. One remaining stray frame at the end of the sped-up hook (frame 80).
- Open questions: memory on long videos (all files held as Blobs, the full audio mix in Float32Arrays, the whole MP4 in memory with in-memory fast start), the main thread blocking during `tempo()` and the audio mix, tab in the background (throttling), the WebGL context being lost, HEVC originals with no working copy, mono sources, a sound shorter than its bar, `samplesAtTimestamps` edge cases, and whether adding the audio after all video is safe in mediabunny.

### 2. Server export lanes (4a3df43 to e295512)

- Exports are 1080x1920 (`render/constraints.json`). Fast lane: `src/lib/server/fast-export.ts`, `/api/internal/export-run` and `/api/internal/export-step` (guarded by `x-mavya-internal` = RENDER_SECRET, listed in `PUBLIC_API` in `src/lib/supabase/session.ts`). Pieces render in parallel Vercel functions, then a join; on failure or after 5 minutes the job goes to the Render worker.
- `render/render.mjs`: `plan()` cumulative frame quantization, the loop filter for overlays (it replaced `-loop 1`, which used 2.8 GB), the frame-exact overlay `enable`, bt709 tags on every piece plus `-reinit_filter 0`, crop before scale, per-piece look and volume, `previewArgs` (lean encoders for two outputs at once).
- `src/lib/server/previews.ts`, `render/server.mjs` `/previews`: a 480p preview copy (`.p480.mp4`) and a 1080x1920 working copy (`.v1080.mp4`) of every upload. `src/app/api/media/[id]/route.ts` `?preview=1`. Account deletion removes all copy names.

### 3. Editor preview and Cut (3fb42aa to 95dbd00)

- `src/components/run-preview.tsx`: two players in fixed slots, the clock follows the playing video (`masterRef`), the slow pre-roll was removed, a 9:16 stage inside the phone, per-piece look filters, `previewOf()` uses the 480p copy.
- Cut: pieces inside one clip, each piece with its own look and volume (`Part.adjust`, `pieceAdjust` in `src/lib/edit.ts`), Speed per clip. A grouped-tile period (bb46047, `clipGroup`, `splitDemoClip`) was reverted in 95dbd00, but some code stays. Is it dead, or still reachable for runs saved during that period?
- `src/components/editor-tools.tsx` and `src/components/run-view.tsx`: Undo, insert on drop (5f06db2), the open clip stays open during uploads, `livePieceAdjust`.
- `src/lib/text-lines.ts`: line breaks are measured once and shared by the preview and `text-png.ts`.
- `showsAt` 1 ms tolerance for captions (3fb42aa).

## How to test

- `scripts/*-checks.cjs` and `scripts/verify-*.cjs` all pass (run each with node). `npx tsc --noEmit`, `npx eslint src render`.
- `next dev` has a Turbopack Google-font error on this machine. Use `next build` and `next start -p 3100 -H 127.0.0.1`.
- Real-browser export test: create a temporary user with a copy of a run, an active plan row, a login cookie, drive Windows Chrome over CDP and click Export. Delete the user and every file it made afterwards: runs, export_jobs, subscriptions, media rows and R2 objects, including export outputs and text PNGs. Never use the founder's account or real customer data for writes.
- Secrets live only in `.env.local`. Never commit `.env*` or `.data`.

## Report format

`docs/CODEX_REPORT_2026-11-04_EXPORT.md`: a summary table first (id, area, severity, one line), then each finding in full, then improvements, then what you verified as correct and how.
