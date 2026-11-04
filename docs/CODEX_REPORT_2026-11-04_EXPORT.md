# Export and editor review, 2026-11-04

| ID | Area | Severity | Finding |
| --- | --- | --- | --- |
| B1 | Browser picture | High | Non-1x frame selection fails for slow motion and some cut tails |
| B2 | Cancellation | High | Completion can mark an export done after cancel deletes its file |
| B3 | Clip editor | High | Piece adjustments reset selection, playhead and Undo |
| B4 | Cut and drag | Medium | Extracted pieces lose their own look and volume |
| B5 | Cut and delete | Medium | A surviving single piece's overrides prevent further settings changes |
| B6 | Clip preview | Medium | Volume and fullscreen look do not follow the active piece consistently |
| B7 | Browser audio | Medium | Mono sources are 3.01 dB louder per channel than server output |
| B8 | Browser audio | Medium | Decode errors silently remove sound from otherwise successful exports |
| B9 | Picture parity | Medium | Shader saturation differs from the preview's CSS matrix |
| B10 | Sound loops | Medium | Short tails loop in preview but stop in exports |
| B11 | Text | Medium | Export font subsets/weights differ from preview |
| B12 | Text | Medium | Unbroken tokens no longer wrap and can be clipped |
| B13 | Upload recovery | Medium | Unbounded PUT and swallowed cancellation failures can keep Export blocked |
| S1 | Storage abuse | High | Browser receives a reusable, unbounded PUT to final media |
| S2 | Server cost | High | Fast lane bypasses worker resource budgets and launches 200 functions at once |
| S3 | Cleanup | Medium | Function deadlines and late writes can orphan intermediate objects |
| V1 | Build | Medium | Default production build fails locally; Webpack build passes |
| I1 | Memory improvement | High | Bound eager source/audio/output allocations |
| I2 | Responsiveness improvement | Medium | Move synchronous audio work off the UI thread |
| I3 | Robustness improvement | Medium | Dispose resources and handle context/tab lifecycle |
| I4 | Test improvement | Medium | Add parity and publication acceptance cases |
| I5 | Deployment improvement | Medium | Check worker dimensions/capabilities, not only protocol 3 |
| I6 | Simplicity improvement | Low | Separate unused split creation from saved-run grouping |

**Verdict:** the speed direction is useful, but 100% preview/export parity is false for concrete supported inputs. Storage publication and cancellation need correction. No critical cross-account compromise was established.

Report only. Reviewed the 30 commits from 7afb5c5 through **6dc5073**, HEAD when this review began, plus their affected call paths. Tests use a physical copy pinned to 6dc5073. Main advanced during review to 769bf3f, adding Clarity/privacy changes; that extra commit is outside this review and its build evidence. No application code, configuration, dependencies, migrations or customer data changed. Nothing committed or pushed.

## Bugs and logic errors

### B1. Slow-motion frame selection is wrong

**High. Confidence: high, reproduced against real ffmpeg and the exact browser timestamp formula.**

Files: src/lib/browser-export.ts:327, :337 and :339; render/render.mjs:153 and :162.

A 30 fps source trimmed to [0.2,1.4), speed 0.5, starts with server source frames 6,6,7,7,8,8. The browser requests 7,7,8,8,9,9. Adding one slot for every speed other than 1 is not equivalent to the two server fps filters around setpts.

Offline tests used lossless grayscale frame-number fixtures, actual stepArgs and actual ffmpeg output. Rendering at 96x160 isolates frame selection from GPU/performance. Results:

| Source | Speed | Output frames | Differing frame selections |
| --- | ---: | ---: | ---: |
| 30 fps | 0.5 | 72 | 70 |
| 30 fps | 0.75 | 48 | 23 |
| 30 fps | 1 | 36 | 0 |
| 30 fps | 1.05 | 34 | 0 |
| 30 fps | 1.25 | 29 | 1, at tail |
| 30 fps | 1.5 | 24 | 0 |
| 30 fps | 2 | 18 | 0 |
| 60 fps | 0.5 | 72 | 72 |
| 60 fps | 0.75 | 48 | 24 |
| 60 fps | 1 | 36 | 0 |
| 60 fps | 1.25 | 29 | 1, at tail |

Other tested 60 fps speeds, 1.05/1.5/2, matched. A 30-then-60 fps VFR fixture, using its actual presentation timestamps, differed on 72/72 grayscale samples at 0.5, 24/48 at 0.75 and 1/29 at 1.25; 1x matched. Grayscale lookup can hide adjacent-frame ties; the initial skipped frame is unambiguous.

These are real server renders plus a deterministic client-algorithm comparison, **not a Chrome/WebCodecs execution**. Installed Mediabunny specifies retrieving the last sample at or before each requested timestamp.

**Proposed fix:** derive one frame schedule including fps rounding and end-exclusive trim. Test the whole 0.5 to 2 range, fractional cuts, VFR, 29.97, B-frame presentation order, originals and working copies. The reported single sped-up tail frame is only one manifestation.

### B2. Cancel races completion and deletes accepted output

**High. Confidence: confirmed with the actual POST handler and advanceExport under controlled interleaving.**

Files: src/app/api/runs/[id]/export/route.ts:52 and :54; src/lib/server/export-jobs.ts:21, :30 and :33.

Completion claims the lease, sees the object and reaches registerMedia. Cancel then marks that job failed without acquiring/checking the lease and deletes its object. Completion resumes, appends the export and writes done because its lease token still matches.

Actual fixture result: state=done, objectExists=false, events register/delete/append. My files/run history can point at a missing output.

**Proposed fix:** serialize cancellation with finalization using the same lease/state contract. Completion must not write done after cancellation wins, and cancellation must not delete a successfully finalized result. Test both winners and storage failures.

### B3. Piece adjustments reset ClipEditor's selection and Undo

**High. Confidence: high; executed the actual invalidation branch. Browser slider gesture not executed.**

Files: src/components/editor-tools.tsx:111, :114, :201 and :208; src/components/run-view.tsx:292.

historyKeyFor now serializes parts containing adjust. Changing exposure on selected piece two changes partsKey. ClipEditor's invalidation branch treats this local adjustment as an external geometry change: clears Undo, selection/draft, stops playback and sets time to zero.

Executing that branch changed pick=p2/time=3/undo=[cut] to pick=null/time=0/undo=[]. The next target falls back to the piece at zero. Later events in one slider drag can therefore edit piece one instead.

**Proposed fix:** distinguish geometry/source/history revisions from local adjustments. Preserve selection/playhead and record the adjustment in Undo. Verify a continuous second-piece drag, not only Cut/Undo.

### B4. Extracting a piece drops its settings

**Medium. Confidence: confirmed by actual moveClipPiece/pieceAdjust execution.**

File: src/lib/edit.ts:298 and :305.

Give piece two exposure 35 and volume 10, then drag it out as its own clip. Extraction copies the parent clip, clears parts and never transfers part.adjust. The hook extraction branch also copies seg.adjust instead of the effective piece settings. Actual exposure changed 35 to 0; volume/keyframes follow the same omission.

**Proposed fix:** transfer effective pieceAdjust onto the extracted clip, preserving clip speed and file-time keys. Cover demo and hook extraction.

### B5. Settings get stuck after deleting down to one piece

**Medium. Confidence: high; helper execution confirms override precedence.**

Files: src/components/editor-tools.tsx:208 and :1568; src/lib/edit.ts:45.

Keep only an adjusted second piece, exposure 35. Both settings handlers now see one part and update the clip's adjustment. The retained part.adjust still wins in pieceAdjust. Requesting exposure 5 leaves effective exposure 35.

**Proposed fix:** normalize surviving single-part settings onto the clip, or consistently edit that retained override. Test delete-to-one, Undo and reopening.

### B6. Clip previews do not consistently follow each piece

**Medium. Confidence: high from effect dependencies/data flow; no audible/browser test.**

Files: src/components/editor-tools.tsx:97, :154, :389 and :2406.

Two failing scenarios:
- Volumes 100 and 0 on consecutive parts: ClipEditor's volume effect depends on seg/version/playing, not the changing active piece. Its RAF changes piece.current/time without those dependencies changing. Part two can stay audible at part one's volume.
- Fullscreen opened while the small editor is on part one: TrimmedVideo receives the outer shown adjustment. Its clock updates fullT, while shown derives from the small editor's t. Fullscreen applies one part's settings across the sequence.

Whole-video SegmentVideos separately computes current-piece settings.

**Proposed fix:** derive look and volume from the actual active part/clock in every player, including fullscreen, and update volume at transitions.

### B7. Mono browser output differs by 3.01 dB

**Medium. Confidence: high; real server conversion measured, browser mapping inspected.**

Files: src/lib/browser-export.ts:159 and :164; render/render.mjs:20 and :173.

decodeSound duplicates mono unchanged into left/right. Server aformat stereo conversion uses approximately 0.707 per channel. A real 48 kHz mono sine measured original/browser-duplicated RMS 0.08836877 versus server per-channel RMS 0.06248616, a **3.0103 dB difference**. This can change clipping under music.

Applies to mono originals, including small uploads without working copies. Already-stereo working copies avoid this particular mismatch. Browser AAC output was not encoded here.

**Proposed fix:** define and test a shared mono/stereo/multichannel downmix convention before mixing.

### B8. Audio decoding failure silently removes sound

**Medium. Confidence: high, explicit error path.**

Files: src/lib/browser-export.ts:165, :212 and :221.

If decodeAudioData rejects for unsupported/corrupt audio or resource failure, decodeSound returns null. Both mixing loops skip the track and the export succeeds silently. An existing audio track failing to decode is different from a video having no soundtrack.

**Proposed fix:** distinguish no track from failed decoding. A real audio decode failure should fail the browser attempt and invoke server fallback.

### B9. Saturation math differs from the editor

**Medium. Confidence: high, mathematical mismatch; no browser pixel measurement.**

Files: src/lib/browser-export.ts:62; src/lib/adjust.ts:179.

Shader luma weights are 0.299/0.587/0.114; preview CSS saturate uses approximately 0.213/0.715/0.072. At supported saturation=-50, a pure-red reference pixel becomes gray about 0.299 versus 0.213, roughly 22 levels apart in 8-bit output before compression. Server eq saturation is another implementation to include in parity tests.

**Proposed fix:** choose one color-space/matrix contract and test color patches and clips across all lanes. Changing colr metadata cannot reconcile different pixel math. [W3C Filter Effects](https://www.w3.org/TR/filter-effects/#funcdef-filter-saturate).

### B10. Short sound tails loop only in preview

**Medium. Confidence: high from algorithms. Server threshold predates this work; browser copies it.**

Files: src/components/run-preview.tsx:370; src/lib/browser-export.ts:225; render/render.mjs:219.

Put a 0.4-second sound on a two-second bar, start=0. At timeline 0.6, preview soundAt maps back to approximately 0.1. Browser has reached the source end and stops; server aloop is disabled because remaining length is not greater than 0.5 seconds. A long sound trimmed to a short tail has the same mismatch.

**Proposed fix:** share the minimum-loop-span policy and test nonzero starts, short files and sample-exact boundaries.

### B11. Export uses different font subsets and sometimes weights

**Medium. Confidence: high from stylesheet selection; visual comparison not performed.**

Files: src/lib/text-png.ts:50 through :56; src/components/run-preview.tsx:518; src/app/(app)/studio/[id]/layout.tsx:6.

A Cyrillic Montserrat caption can use the proper font in preview. Export discards all stylesheet blocks except latin/latin-ext when present, forcing fallback glyphs for Cyrillic. Shared line breaks cannot repair different glyph shapes/metrics.

There is also an existing Latin-font mismatch that the new shared-break approach does not solve: the editor's Montserrat face provides weights 700 and 900, while TextRender requests 800. Export explicitly fetches weight 800. CSS face matching therefore uses a different weight in the editor. This is a source-level finding, not a measured screenshot comparison.

**Proposed fix:** use the same font bytes, weight and required character subsets in preview and export. Add Montserrat and non-Latin caption fixtures.

### B12. Unbroken text no longer wraps

**Medium. Confidence: high, direct algorithm/layout change; no screenshot test.**

Files: src/lib/text-lines.ts:51; src/components/run-preview.tsx:518; src/lib/text-png.ts:83.

textLines wraps only at spaces and accepts an oversized first word. New white-space:pre prevents the previous overflow-wrap behavior. Long URLs, hashtags or unbroken words can exceed the box/frame and lose letters when clipped.

**Proposed fix:** split overlong tokens at measured grapheme boundaries and share those exact breaks with export.

### B13. PUT and cancellation recovery are incomplete

**Medium. Confidence: high, explicit request/control flow.**

Files: src/components/export-button.tsx:135, :142 and :145; unmount cleanup at :24.

A PUT that remains pending never reaches retry/cancel: it has no deadline or abort signal. jobId is set only after successful PUT, so this tab is not polling its reservation during the hang.

If three attempts reject and cancel POST also fails, its failure is swallowed and the UI clears blocked. The durable active job can still occupy Export until timeout/recovery; another click can recover the same job. Immediate freeing is conditional on server acknowledgment. Unmount does not abort export/upload or revoke the blob URL.

**Proposed fix:** bound PUTs, connect an export-lifetime abort signal, recover once reserved and reconcile cancellation failure. Preserve local download while handling failed persistence.

## Security and abuse

### S1. Browser can mutate canonical output and retain rejected bytes

**High. Confidence: high; actual finalizer probes, signing code and R2 semantics. No live bucket abuse.**

Files: src/app/api/runs/[id]/export/route.ts:130; src/lib/server/store.ts:358; src/lib/server/r2.ts:102; src/lib/server/export-jobs.ts:26.

local returns a six-hour PUT to media/<final-id> without size/checksum binding. Finalization checks HEAD size/type, not an MP4 container, dimensions, duration or expected bytes.

Actual advanceExport probes:
- Three arbitrary bytes labeled video/mp4 become done and are appended.
- A 400 MiB object becomes failed, then cleaned=true, **without deletion**.
- Signed PUT remains reusable after done/cancel: it can overwrite registered media or recreate an output after cancellation's one-time deletion. Stored metadata can then describe earlier bytes.

The 300 MiB check happens after storage acceptance. No other user's key is exposed, and accepting arbitrary valid user MP4s is not inherently an exploit or billing bypass. Unbounded grants, mutable final identity and retained rejected output are the defects.

Account deletion snapshots export-job media IDs and waits for six-hour grants; I did not establish canonical-key resurrection after that deletion policy.

**Proposed fix:** short size-bound staging grant, ETag/checksum-matched finalization, bounded validation and copy to an immutable canonical key. Persist rejected/canceled/late-upload cleanup through grant expiry. Ordinary uploads already use staging and conditional copy.

[Cloudflare R2 presigned URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) confirms reuse until expiration. Content-Type does not prove contents.

### S2. Fast lane bypasses resource budgets and amplifies cost

**High. Confidence: high; actual coordinator reached peak 200 offline step calls.**

Files: src/lib/server/fast-export.ts:53, :62, :78 and :100; render/limits.mjs:2; render/server.mjs download/probe/work.

Worker guards include 300 MiB/file, 600 MiB/job, dimensions/duration, overlay pixel area, download concurrency and queue limits. Fast lane omits those budgets: unbounded streaming download, no validProbe, no overlay-area check, all steps launched together.

A valid 40-clip/five-pieces-each spec produced **200 calls, peak concurrency 200** with actual runFastExport and stubbed responses. Every piece independently downloads its whole original. A 300 MiB original reused 200 times implies about **58.6 GiB** piece-input transfer versus one worker-cached download. That is an envelope calculation; no such transfer was made.

Internal auth is intact. This is authenticated cost/capacity abuse, not public anonymous invocation.

**Proposed fix:** apply transfer/media/overlay budgets and bounded admission/concurrency to the fast lane; reduce full-source redownloads. Preserve bounded-job speed without silently dropping limits.

### S3. Intermediate objects lack durable late-writer cleanup

**Medium. Confidence: high from deadlines/ownership paths; Vercel termination not induced.**

Files: src/lib/server/fast-export.ts:81, :100, :111 and :120; internal export route maxDuration; src/lib/server/account-deletion.ts:47.

Coordinator can wait 290 seconds for pieces then begin join work inside a 300-second function. Steps separately allow 120-second download, probe and 270-second render. These ceilings do not fit one shared deadline.

Platform termination can prevent finally cleanup. Alternatively, a step can upload after its caller's 290-second timeout and after coordinator deletion. exports/<job>/sN.mkv then remains. Those keys have no media-ledger/deletion-snapshot/durable cleanup owner outside best-effort finally.

Timing and laneFailed also replace payload from non-leased snapshots, so concurrent lane changes can be overwritten.

**Proposed fix:** shared deadline, attempt/lane tokens rejecting late writes, durable intermediate expiry/cleanup, and timing updates that cannot replace unrelated lane state.

## Verification issue

### V1. Default production build fails locally

**Medium. Confidence: confirmed locally; not evidence the deployed artifact is broken.**

File: src/app/(app)/studio/[id]/layout.tsx:1 and :6; Next 16.4.0 compiler path.

Clean physical copy, Node 22.23.4: typegen/TypeScript/lint pass; next build fails with ten Turbopack Google-font resolution errors including Montserrat and “next/font/google queries have exactly one entry.” next build --webpack passes. Existing TikTok Sans fallback-metrics warning also appears.

The request's statement that only next dev has the font issue is false here.

**Proposed fix:** reproduce the compiler/font failure and choose an explicitly verified deployment build path before changing code. No compiler/dependency/font changes made. Webpack success does not make the default command pass.

## Improvements and expected gain

### I1. Bound browser memory and fetch lookahead

High improvement priority/severity. Confidence: high on allocations; actual peak heap unmeasured. Files: src/lib/browser-export.ts:181, :195, :202, :253 and :370.

All source Blobs, full decoded source audio, stereo mix, extra AudioBuffer and in-memory MP4 buffering overlap. At 180 seconds, mix=69.12 MB decimal, extra AudioBuffer=69.12 MB, nominal 10 Mbps+160 kbps output=228.6 MB. These named allocations/output alone represent about 367 MB before sources, surfaces, textures and extra muxer copies. One-hour stereo 48 kHz float PCM is about 1.38 GB even when exporting a short trim.

Expected gain: bounded working memory rather than whole-project retention, fewer crashes on valid long projects. Apply admission budgets, bounded lookahead, dispose completed inputs and use chunked audio/muxing where supported. Actual browser peak heap is unmeasured; no invented reduction percentage.

### I2. Move CPU audio work off the UI thread

Medium improvement priority/severity. Confidence: high on synchronous execution and local timings. Files: src/lib/browser-export.ts:111 and :216.

Executed actual tempo in Node on stereo sine input:

| Input | Speed | Synchronous time |
| --- | ---: | ---: |
| 3 s | 0.5 | 46.3 ms |
| 3 s | 1.5 | 11.3 ms |
| 30 s | 0.5 | 386.7 ms |
| 30 s | 1.5 | 126.9 ms |

Mix loops add work. Worker processing or bounded yielding would remove hundreds of milliseconds of contiguous UI blocking for these sizes. These are local Node timings, not browser responsiveness measurements or total-export speed gains. Validate WSOLA with speech/transients/stereo phase as well.

### I3. Close resources and handle GPU/tab lifecycle

Medium improvement priority/severity. Confidence: high that explicit lifecycle handling is absent; device behavior unmeasured. Files: src/lib/browser-export.ts:68, :290 and :375; src/components/export-button.tsx:24.

Retain/dispose Input references, cancel Output on errors, close bitmaps/textures/contexts, revoke obsolete blob URLs and abort outstanding downloads. Handle WebGL context loss and encoder failure before publication; connect the optional signal from the UI. Define hidden-tab behavior.

Expected gain: bounded live resources after failure/navigation and explicit fallback on resource loss. Actual context-loss/background behavior remains untested. I am not claiming every lost context currently produces a black MP4; the encoder may reject first.

### I4. Make parity/lifecycle tests release checks

Medium improvement severity, high implementation priority. Confidence: high. Evidence: scripts/export-checks.cjs:1 and scripts/verify-previews.cjs:1, plus the actual-module probes documented above. The 33 passing suites missed the reproduced cases.

Expected gain: detect frame identity, sample-level audio, piece mutation and cancellation/publication errors before shipping. Add actual Chrome fixture exports and cleanup, mixed 25-second projects and the allowed maximum envelope. Pixel/frame/sound tests should distinguish expected compression noise from changed content.

### I5. Make worker capabilities versionable

Medium improvement priority/severity. Confidence: high on the mixed-version failure path. Files: src/lib/server/export-jobs.ts:61; render/server.mjs /health; render/constraints.json:2.

Protocol stays 3 while required size changes 720x1280 to 1080x1920. An older protocol-3 worker passes health then rejects the new job, causing repeated dispatch failure.

Expected gain: explicit incompatibility before dispatch during partial deployments. Check dimensions/capabilities or bump a breaking protocol. This is not a claim that the currently hosted worker is old.

### I6. Preserve reachable legacy grouping

Low improvement priority/severity. Confidence: high from call sites. Files: src/lib/edit.ts:255 and :279; src/components/editor-tools.tsx:2102 and :2111; src/components/run-view.tsx:694.

splitDemoClip has no current app caller after revert; current RunView does not supply ClipEditor's optional onSplit creation path. However grouped tiles, clipGroup, member navigation and grouped reordering remain reachable for saved group values.

Expected gain: simpler compatibility ownership if unused creation is removed after agreement. Do not delete all grouping as dead code: saved runs can still require it.

## What I checked and found correct

- **Auth/billing:** session.ts still gates the export route, including new modes; currentUser/account and getRun owner checks remain. Existing persona/route and SQL suites pass. No confirmed paid-gate or generation-credit bypass.
- **Source ownership:** inputLink checks mediaAccess before working-copy lookup/signing. Spec comes from the owned saved run, not browser-submitted arbitrary URLs. Shared sounds/app files are deliberate exceptions. No foreign-media link leak found.
- **Internal auth:** both public-listed internal handlers call internalOk. Actual helper rejects absent/wrong secrets and accepts matching fixture secret, with minimum length and timing-safe comparison. HTTP checks against the no-credentials production build returned fail-closed proxy 503, not a claimed live secret-handler 404.
- **Reservation:** SQL locks the owned run, checks snapshot and enforces one active export/user. sources does not reserve an output; local reserves a browser lane. These controls do not fix S1/B2.
- **Preview copies/deletion:** original mediaAccess protects preview links; deterministic p480/old-preview/v1080/old-master names are included in account deletion after grant grace. Ordinary upload staging retains size/ETag checks. Fast intermediate objects are separate, S3.
- **Hook/HEVC handling:** generated hook keeps its original; demo working copy requires access/existence. Undecodable browser video throws into server fallback. Chrome/Edge capability detection checks encoders/WebGL/WebCodecs, not every source decoder.
- **Frame counts:** cumulative plan rounding avoids per-piece inflation; both lanes use it. Real ffmpeg suites pass. B1 concerns source frame choice within a planned piece.
- **Overlay changes:** finalArgs uses internal PNG loop filters and frame-rounded enable boundaries; browser uses the same rounded start/end. Real ffmpeg overlay tests pass. No new 200-overlay/1080p peak-memory certification.
- **Preview slots:** alternating fixed slots retain the active element position; masterRef follows playing media. The 9:16 stage and pre-roll removal are present. Freeze-free joins on all devices are unverified.
- **Piece export mapping:** route emits per-piece look/volume; both export loops consume them; speed stays per clip. New Cut creation copies existing part adjustment. Mutation/preview edge failures are listed above.
- **Product flow:** paste no longer invokes analysis; explicit Analyze retains step 1 via analyzedHere. No product-flow changes made in this review.
- **Font caching:** per-family fetch caching/shared line measurement exist. They do not resolve B11/B12.
- **Analytics:** Vercel analytics/speed-insights are in the reviewed public layout. Later Clarity/privacy commit is excluded; no hosted analytics/configuration certification.
- **Audio mux order:** picture closes before audio is supplied; audio closes before finalize. Serial track supply is supported; early close is recommended. Memory buffering remains a concern, not an established deadlock. Checked installed Mediabunny 1.61.6 and [media-source](https://mediabunny.dev/guide/media-sources) / [writing](https://mediabunny.dev/guide/writing-media-files) docs.
- **Color tags:** bt709 changes nclx transfer metadata, not pixel values. QuickTime/iPhone equivalence, and the claimed 33 dB PSNR, remain unverified.

## Execution evidence and limits

Pinned source 6dc5073; Node 22.23.4; physical copy with installed dependencies, no actual .env/.data, founder's .next preserved.

| Check | Result |
| --- | --- |
| 21 scripts/*-checks.cjs | PASS |
| 12 scripts/verify-*.cjs | PASS |
| next typegen | PASS |
| npx tsc --noEmit | PASS |
| npx eslint src render | PASS, no warnings |
| npx next build | FAIL, ten Turbopack font-resolution errors |
| npx next build --webpack | PASS |
| Actual helper/handler state probes | Reproduced B2/B4/B5/S1 |
| Actual ClipEditor invalidation branch | Reproduced B3 reset |
| Actual coordinator, offline transport | Peak 200 steps |
| Real ffmpeg frame/mono tests | B1/B7 comparisons |
| Live Chrome export / 23-second claim | NOT VERIFIED |

Temporary reproducible probes/logs are retained under /tmp/mavya-export-review-2Hfrpf/probe and /tmp/mavya-export-review-2Hfrpf/evidence. They are not repository changes.

The claimed 23-second display, 29.5-second persistence, 757 frames, 33 dB PSNR and sample-aligned sound were not repeated. They are request inputs, not verified measurements here.

The requested temporary-user browser flow was not completed: automatic approval review rejected launching the dedicated muted Chrome process, stating **blocked by policy**. No browser-capable tool or installed WSL browser provided a permitted fallback. No temporary live user, subscription, media row, text image or R2 object was created, so no live test-account cleanup remains.

No credentials were printed, production writes or paid provider calls made, or music/audio played. Media was synthetic and processed offline. No commits/push/merge/deployment. This report is the only repository file added by the review. Claude can agree a bounded fix list before implementation.

