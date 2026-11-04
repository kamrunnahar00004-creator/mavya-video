# Review of export fixes, 2026-11-04

| ID | Area | Severity | Finding |
| --- | --- | --- | --- |
| F1 | Frame timing | High | Subtracting video first timestamp shifts cuts for offset video/audio tracks |
| F2 | Packet scan | Medium | A future P-frame stops decode-order scanning before wanted B-frames |
| F3 | Short pieces | Medium | Empty/sub-frame cuts still produce different browser/server behavior |
| F4 | Fast-lane limits | High | Concurrent streams bypass the shared byte budget; some inputs remain outside it |
| F5 | Promotion recovery | Medium | A staging rewrite after a copy failure can strand canonical media outside exports/ |
| F6 | Export lifecycle | Medium | Unmount abort still launches the server fallback |
| F7 | Fast-lane deadlines | Medium | Deadline checks do not cover the whole job or eliminate late writes |
| F8 | Upload validation | Medium | Header inspection is not bound to the ETag copied to canonical storage |
| F9 | Fallback parity | Medium | Browser saturation is fixed, but server fallback still differs |
| F10 | Upload deadlines | Medium | Client can allow a 20-minute PUT into a 15-minute browser job |
| F11 | Frame test | Low | A schedule with every reference missing still passes all 240 cases |
| L1 | Loop edge | Low | Remaining tails at most 50 ms still use different loop rules |
| C1 | Auth masking | Low | Forgot-password confirmation email is outside the explicit mask |

**Decision:** many fixes are real, including the old cancellation race and the piece-editing bugs. The response's blanket “fixed” verdict is too strong for B1, B9, B10, B13, S1, S2 and S3. All 34 suites, TypeScript, lint and the production build pass; the additional probes below reproduce gaps outside those suites. No critical cross-account compromise was established.

Reviewed de323bd and 769bf3f. During this review another process committed bf6ae8b, which updates the request's Clarity scope, masks authentication forms and changes the privacy wording. I incorporated that commit too. The founder explicitly wants editor text recorded; I did not treat that product choice as a defect.

**Report only:** I changed no application code, tests, configuration or dependencies, and made no commit/push/deployment. This report is my only repository addition.

## Findings

### F1. Video-track origin is not always ffmpeg's input origin

**High. Confidence: high, actual packet metadata and real ffmpeg reproduction.**
Files: src/lib/browser-export.ts:322, :358, :362 and :369.

Fixture: a two-second H.264 video whose first picture timestamp is 0.3 s, with an audio track starting at 0. Trim [0.5,1.5), speed 1, no working copy. The browser subtracts the picture's 0.3-second origin from every packet timestamp before scheduling and adds it back when reading frames. ffmpeg's input timeline for this file has a different origin because audio begins earlier.

Result: **30 of 30 output frame references differ**. First server grayscale values are 7,8,9,10,12,13,14,15; browser-reference values are 17,19,20,21,22,23,24,26. The browser effectively selects pictures roughly 0.3 seconds later, also changing their alignment with source audio.

This probe uses the installed Mediabunny's actual Input/EncodedPacketSink and real stepArgs. It compares selected source frames, not a browser-encoded MP4.

**Suggested fix:** derive the same container/input timestamp normalization and edit-list behavior as ffmpeg. Neither blindly subtracting the first picture timestamp nor blindly using the earliest audio packet handles every file. Add offset A/V fixtures, including encoder priming and video-only files.

### F2. Decode-order scanning can miss presentation frames inside the cut

**Medium. Confidence: confirmed with actual EncodedPacketSink metadata and ffmpeg.**
File: src/lib/browser-export.ts:358 through :365.

The iterator is in decode order, but the break condition uses presentation time: stop at a packet past cut end + 1 second.

A supported small H.264 file at 2 fps with three B-frames, cut [0,0.9), has packet presentation times beginning **0,2,1,0.5,1.5** in decode order. The scan stops at 2, before seeing the needed 0.5-second B-frame. Full metadata confirms that frame exists.

The resulting browser schedule differs from the actual server on **12 of 27 frames**. The 240-case test does not establish a universal one-second reordering bound.

**Suggested fix:** collect a complete decode dependency/presentation interval, such as through a safe keyframe boundary or all bounded metadata, instead of using an arbitrary PTS cutoff. Add low-frame-rate B-frame fixtures and verify the scan itself, not only frameSchedule with an already-complete PTS array.

### F3. Empty and very short trims still disagree

**Medium. Confidence: confirmed by actual ffmpeg and schedule tests.**
Files: render/frames.mjs:23 and :40; render/render.mjs:135 and :153; src/lib/browser-export.ts:369.

A 30 fps file trimmed to [0.005,0.015) contains no source frame. plan still creates output frames because of its minimum piece length. frameSchedule returns -1 references, which the browser renders black. The server produces no usable video stream for that piece.

Another example, [0.001,0.051) at speed 1.25, retains a source frame but the server's fps/setpts chain can produce no video packets. The schedule forces at least one slot and supplies a picture.

Expanded tests covered 56 combinations of keyframes/no keyframes, seven speeds, fractional short cuts and file-end cuts. There were **22 empty-video failures** in the short-cut cases, including the examples above. The other 34 cases matched source-frame references. The normal file-end and ordinary keyed cases did not reveal a frame-selection mismatch.

**Suggested fix:** define one policy for pieces without a renderable frame and enforce it consistently at admission and rendering. Do not silently generate black in one lane while the fallback cannot render the same saved project. Test actual packet/frame durations as well as PTS.

### F4. The shared transfer budget is racy and incomplete

**High. Confidence: confirmed using the actual download function and real streams.**
Files: src/lib/server/fast-export.ts:60, :69, :74 and :138 through :141.

Each stream checks budget.bytes + its own accumulated bytes, but budget.bytes is increased only after a complete download. Concurrent streams can all pass against the same old total.

Three synchronized **250 MiB** streams passed a **600 MiB** shared budget and finished with **750 MiB accepted**. The test used actual TransformStream/pipeline processing and a discard sink, not external downloads or large disk writes.

In addition:
- Intermediate piece downloads at :138 do not receive that budget at all.
- The fast lane still does not enforce the worker's aggregate decoded overlay-area budget.
- Output size is not bounded before the fast lane's final PUT as it is in the worker.

The 24-step admission and 12-way concurrency are genuine improvements, verified separately. They do not make the remaining budget checks effective.

**Suggested fix:** charge shared bytes as each chunk is admitted, with one job-wide abort on exhaustion. Apply explicit transfer/disk/decoded-overlay/output budgets to every relevant phase. A different intentional intermediate-file budget is fine; silently leaving them uncounted is not.

### F5. Promotion retry can strand a canonical object

**Medium. Confidence: confirmed with actual advanceExport under controlled storage failures.**
Files: src/lib/server/export-jobs.ts:23 through :30, :65 and :119.

Concrete sequence:
1. A valid staging upload is copied to media/<id>.
2. Staging deletion fails. The job remains active and the lease is released.
3. The still-valid staging PUT is replayed with different, invalid bytes of the same declared size.
4. Retry inspects staging first, rejects it and marks the job failed before considering the existing canonical output.
5. Cleanup marks the job cleaned, without registering or deleting that canonical object.

Probe result: **state=failed, cleaned=true, canonical retained=true, registered=false**. This object is outside exports/, so the provided lifecycle rule will not remove it. Its export-job identity still allows account deletion to find it; it is not an established cross-account ownership loss. It remains undiscoverable in ordinary My files and uncollected for the active account.

**Suggested fix:** make canonical publication recoverable independently of later staging mutations. Reconcile an already accepted canonical object before rejecting a new staging version, and persist cleanup of abandoned canonical outputs.

### F6. Aborting the browser attempt starts a server export after unmount

**Medium. Confidence: confirmed by executing the actual ExportButton with offline service stubs.**
Files: src/components/export-button.tsx:30, :93 and :97 through :112.

Unmount aborts lifetime.current. The browser attempt rejects, but start catches every browser rejection and treats it as a request for fallback. It then draws/uploads text images and posts a server export, even though alive is false.

Actual component event sequence:
**browser-start -> browser-abort -> server-export-after-unmount**.

The UI no longer displays this work. With texts, uploads can also continue after leaving. This directly refutes the claim that leaving stops the whole export.

**Suggested fix:** distinguish cancellation from unsupported/failed rendering. An aborted lifetime or unmounted component must exit rather than fall back. Guard subsequent awaits and reservation steps, and connect the same lifetime to requests where appropriate.

### F7. The deadline is not shared end to end

**Medium. Confidence: actual step probe plus source inspection; no Vercel timeout induced.**
Files: src/lib/server/fast-export.ts:103, :106, :125, :146 and :149.

The 170-second deadline bounds piece admission and influences a piece's ffmpeg timer. Download/probe can run past it. Join still receives a fresh 270-second timer and final PUT a fresh 120-second timer inside a 300-second function.

Also, :106 checks left() before awaiting payloadOf. The deadline can pass while that query runs, and the following PUT still starts. In an actual renderStep probe with a controlled clock, payloadOf crossed the deadline and **putObject was called after it**. A PUT admitted just before expiry can also finish after coordinator cleanup.

The lane-guarded payload writes are correct and prevent a changed lane being overwritten by those updates. The founder-provided one-day exports/ lifecycle bounds retention of leftover intermediates, assuming it is installed as stated. Neither makes “a step past the deadline never uploads” true or guarantees completion within the function budget.

**Suggested fix:** carry one remaining-time/abort budget through download, probe, render, join and upload; recheck after awaited state checks, and reconcile late writes. Retain lifecycle cleanup as a backstop, not the only response to predictable function termination.

### F8. Header validation can inspect different bytes from the ETag copy

**Medium. Confidence: confirmed by the actual promoteUpload function with a controlled staging-version race.**
Files: src/lib/server/export-jobs.ts:25 through :29; src/lib/server/r2.ts:113.

HEAD reads version A. objectStart has no If-Match condition and can read version B. A client can restore A before copyObject, so CopySourceIfMatch(A) succeeds even though the ftyp check examined B.

Probe result: **accepted=true, copied signature=four zero bytes, ETag copy matched=true**. The copied file does not satisfy even the ftyp check.

Separately, a 12-byte ftyp marker is only a signature sniff, not verification of a playable MP4, duration or dimensions. A forged 12-byte object can still pass that limited check. Accepting arbitrary paid-user files is not itself a cross-account exploit, but the response should not call this complete MP4 validation.

**Suggested fix:** bind the ranged read to the same ETag and fail/retry on mutation. Define the required bounded container validation separately from MIME/signature checks. Keep staging mutable and canonical immutable.

### F9. Server fallback retains the saturation mismatch

**Medium. Confidence: actual ffmpeg/reference pixel comparison; live browser color conversion unmeasured.**
Files: src/lib/browser-export.ts:63; render/render.mjs:89; src/lib/adjust.ts:179.

The browser shader now uses CSS weights and fixes the specific original shader mistake. Server eq still works in its YUV pipeline; that is not the same universal transform as CSS RGB saturation.

A tagged SMPTE-170M red fixture, decoded reference RGB [254,0,0], at saturation -50:
- CSS/new shader formula: gray approximately **54.1**.
- Actual 1080x1920 server step, decoded RGB: **[73,76,73]**.

This is a reference-pipeline test, not an actual Chrome screenshot. It demonstrates that keeping the server as-is does not establish parity for all source color spaces. A fallback path is still user-visible product output.

**Suggested fix:** define and apply the same color conversion/filter contract in both lanes. Include known matrix/range/transfer tags and color patches in acceptance tests. Relabeling output tags alone is not a conversion.

### F10. Client and server upload clocks disagree

**Medium. Confidence: code arithmetic and actual expiration/recovery fixture.**
Files: src/components/export-button.tsx:149 through :151; src/app/api/runs/[id]/export/route.ts:136; src/lib/server/export-jobs.ts:82.

For an allowed 240,000,000-byte blob, the client allows **20 minutes per PUT**. The staging grant and browser-job wait are **15 minutes**. At roughly 220 KB/s, an upload takes about 18 minutes and fits the client deadline, but recovery can already have failed/cleaned the job at 15 minutes.

Controlled recovery: expire an empty browser job after 16 minutes, then deliver its staging object. Result remains failed/cleaned, no canonical output; the late stage is retained for lifecycle expiry. This does not test whether R2 accepts a specific long request after grant expiry, but the job mismatch exists regardless if that PUT completes.

The local video remains downloadable, while persistence fails despite finishing within the client's own allowance.

**Suggested fix:** use one upload/reservation deadline, include retries in it, and stop or renew/reconcile before the server considers the job terminal. Tell the user when a local result cannot be saved instead of waiting through an already-invalid window.

### F11. The frame comparison accepts missing references as matches

**Low. Confidence: confirmed by fault injection in a separate temporary copy.**
File: scripts/frame-schedule-checks.cjs:40 through :43.

The comparison calculates Math.abs(v - ours[i]) > 1. An invalid source index produces undefined in ours; subtraction becomes NaN, and NaN > 1 is false. Only the server frame count is checked.

In a disposable mutant copy, I replaced frameSchedule with a function returning source=-1 for every output frame. The unmodified test still exited successfully with **“240 cases match ffmpeg frame for frame.”** The application source and the verified build copy were not mutated.

**Suggested fix:** assert schedule/reference lengths, finite values and valid source indices before pixel comparison, with an explicit separately tested policy for empty intervals. Keep a negative/mutation case demonstrating that missing/wrong mappings fail. This does not mean the current schedule fails every normal fixture; it means the stated green result is weaker than claimed.

### L1. Very short sound tails still diverge at the mapping level

**Low. Confidence: high on formulas; audible preview behavior not tested.**
Files: src/lib/browser-export.ts:250; render/render.mjs:219; src/components/run-preview.tsx:370.

The reproduced 0.4-second case is fixed. However both exports still require rest > 0.05 before enabling looping. Preview soundAt has no matching gate. For a one-second sound starting at 0.98 on a long bar, at timeline 0.5 preview maps to 0.98 again; export loop is disabled.

**Suggested fix:** explicitly share the minimum-tail policy or reject that tail consistently. Do not claim sample-identical looping from the common 0.4-second test alone. Actual audible impact also depends on SyncedAudio behavior and needs a browser test.

### C1. Forgot-password status text is outside the auth mask

**Low. Confidence: high on source; actual capture conditional on Clarity configuration.**
File: src/components/auth-modal.tsx:211 through :215.

All seven auth/reset input elements are under explicit masked forms, including password inputs after the show-password toggle. That passes the requested field check.

After sending a recovery email, the form is replaced with a paragraph echoing email.trim() outside that mask. In a relaxed recording configuration intended to show editor text, this ordinary DOM text is not protected by the form attribute. Balanced mode may automatically mask emails; dashboard mode was not inspected.

**Suggested fix:** mask this authentication-status paragraph or the auth container too. This is not a claim that a password was recorded.

## Verdict for every earlier finding and response claim

“Fixed” below means the identified code defect is fixed on the tested path, not that production browser parity or every device was certified.

| Earlier ID | Verdict | Evidence / boundary |
| --- | --- | --- |
| B1 | Partly fixed | Original 14 frame probes now have zero differing grayscale samples; committed 240-case suite passes. F1/F2/F3 cover missed origins, decode-order scan and short cuts |
| B2 | Fixed | Actual concurrent completion/cancel probe: cancel returns pending while completion holds the lease; job ends done with output retained. Empty cancel marks failed |
| B3 | Fixed | Actual historyKeyFor is unchanged when only adjust changes; no invalidation branch. File editor-tools.tsx:112 |
| B4 | Fixed | Actual moveClipPiece retains exposure 35 and volume 10; demo/hook branches use pieceAdjust, edit.ts:306 |
| B5 | Fixed | Actual lone-part setAdj calls onPieceAdjust and saves exposure 5. Both editors have the override-aware condition |
| B6 | Fixed on checked paths | Actual clip RAF transition sets volume 0.1; actual fullShown expression selects second-part exposure 35 from fullscreen time. Interactive/audio sync unverified |
| B7 | Fixed | Actual decodeSound maps mono sample 1 to approximately 0.70710677 per side, matching the measured server convention |
| B8 | Fixed | No-track returns null; real decode failure throws. A metadata-parser rejection still proceeds to Web Audio, so it does not automatically reject a library sound that Web Audio can decode |
| B9 | Partly fixed | Browser coefficient change is correct; response explicitly leaves server eq. F9 shows remaining fallback difference |
| B10 | Partly fixed | Real ffmpeg 0.4-second source now loops every 0.5 seconds with silent padding, matching browser formula. L1 is an unaligned threshold edge |
| B11 | Fixed for identified cases | Montserrat 800 present; covers selects explicit Cyrillic ranges. Per-URL file cache avoids repeated font-file downloads. Actual non-Latin browser pixels unverified |
| B12 | Fixed | Actual textLines with deterministic measurement splits 150 ASCII characters into three lines and 100 family-emoji graphemes into two without splitting graphemes or losing text |
| B13 | Partly fixed | PUT deadlines, uncertain-cancel polling and unmount revocation exist; F6/F10 remain. post(local) itself is not linked to lifetime, allowing further post-unmount work |
| S1 | Partly fixed | Browser receives a short size-bound staging grant, not canonical PUT. Three arbitrary bytes are rejected/deleted. F5/F8 remain; ftyp alone is not a full parser |
| S2 | Partly fixed | Actual coordinator: 24 steps, peak 12, deadline passed to each. Actual 25-step job bypasses fast lane. F4 remains |
| S3 | Partly fixed | Changed-lane guards and pre-upload checks exist; F7 remains. Lifecycle rule limits exports/ leftovers, not F5 canonical leftovers |
| I3 | Partly fixed | Inputs/bitmaps disposed, failed Output canceled, GL released, context-loss check before encode. F6 remains; abort/fallback and all outstanding resource lifetimes are not fully reconciled |
| I4 | Partly fixed | Frame schedule suite plus staging/cancel/worker-size assertions added and passing. F11 shows a false-green path; no actual Chrome fixture in CI |
| I5 | Fixed | advanceExport now rejects protocol-3 720x1280 health and accepts required 1080x1920; executable export suite verifies it |
| I1 | Deferred, not fixed | Eager source/audio/output retention remains. Three-minute cap does not bound input bytes or full-source decoded PCM |
| I2 | Deferred, not fixed | tempo and mix remain synchronous on the UI thread |
| I6 | Intentionally unchanged | Legacy group reading/reordering remains reachable; unused split creation was not removed |
| V1 | Not reproduced now | Default Turbopack production build passes in the isolated copy. Prior root cause is not established; do not infer “no Google network access” solely from this success |

### Claimed live-browser evidence

Claude reports 24 seconds to display, 37 seconds to save, 757 frames, 33.8 dB average / 29.1 dB minimum PSNR (up from a claimed 17.8 minimum), sample-aligned sound, and a successful upload-block/cancel test. These are **not independently verified here**. They may describe that one project accurately; they do not establish the missed input classes above. Hidden-tab WebCodecs continuity is also unverified rather than guaranteed across devices.

The provided facts that the worker runs de323bd and R2 has a one-day exports/ lifecycle rule were treated as deployment inputs. I did not inspect or modify their live configuration. Lifecycle deletion is not a fix for a canonical media/ object.

## Clarity review under the updated founder scope

- Root layout loads the standard async Clarity tag afterInteractive with one stable Next Script id. The public project ID is not a secret. An explicitly empty environment value disables it.
- bf6ae8b adds data-clarity-mask to login/signup, forgot-password and reset-password forms. AST ancestry inspection verifies **five AuthModal inputs and two reset inputs** remain under that mask, including conditional type=text show-password states. The toggle does not remove the ancestor.
- Current privacy wording explicitly discloses sessions, editor text and the password exception. It removes the earlier unqualified “anonymized” description. That aligns with the newly stated product policy. C1 is a narrow remaining auth-status boundary.
- Microsoft's documentation says input boxes/dropdowns are masked in all modes, and explicit ancestor masking covers descendants. Do not assume this integration can record arbitrary raw input values merely because the founder wants them; rendered editor text can be captured according to settings. [Microsoft masking documentation](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking).
- No live Clarity recording, masking dashboard or transport payload was inspected. I did not broaden this into a consent/legal review or oppose the authorized recording of editor content.

## What was verified as correct

### Frame schedule and media handling

The original failed source-frame probes were rerun using the new schedule: **14 cases, zero differing grayscale samples**. All 240 committed cases pass, with the assertion weakness in F11. Additional ordinary keyed/uncut/file-end source-reference cases also passed; the expanded failures were short/empty cuts.

Actual packet parsing succeeds for a quarter-turn H.264 fixture (rotation 270, display 180x320, 60 packets) and a HEVC fixture (96x160, 60 packets). These prove metadata handling for those fixtures, not GPU orientation, HEVC decode availability or complete WebCodecs export on a particular Chrome build. The browser's track.canDecode rejection still has a server fallback.

Keyframed grayscale tests check source-frame selection, not spatial crop/zoom pixel parity. That distinction matters: this session did not render the browser's WebGL result.

### Sound and text

Real ffmpeg loop test: a 0.4-second sine on a two-second bar had RMS about 0.0623 at 0.1/0.6/1.1/1.6 seconds and zero at 0.45/0.95/1.45/1.95. Browser span/index logic matches that common case. No audio was played.

The mono/decode probes execute actual decodeSound with controlled track/decode results. Metadata parser failure falls through to decodeAudioData, while a failed decode rejects instead of silently muting. ALL_FORMATS includes MP4/QTFF, MP3, WAVE, ADTS and other relevant formats. This is not a certification of every library file.

Text tests exercise actual grapheme splitting and explicit Unicode range selection. Montserrat's editor weight now includes 800. Font-face caching is per family/text; actual font files are cached per URL. CSS is fetched again for distinct texts, so the response's file-cache claim is correct but should not be read as “one stylesheet fetch per family.” Full browser glyph/line/pixel comparison remains unverified.

### Upload, cancellation, ownership and deletion

Normal actual promotion copies under an ETag and removes staging. Wrong-size/signature fixtures fail without canonical publication. Cancellation takes the same lease and no longer deletes accepted output. Foreign-owner/run protections remain; no new public auth or paid-gate bypass was found.

Using the installed AWS signing SDK with dummy credentials, the equivalent staging PUT signs **content-length;host**, expires in 900 seconds and requires the exact declared length. Content-Type is checked during promotion; it is not in that signature's signed-header set. No real R2 request was made.

Staging replay is confined to exports/ and does not itself overwrite immutable canonical bytes. Late uploads after cancellation/expiry can still land there until grant/lifecycle expiration. That bounded staging retention is expected; F5 is different because it leaves media/ behind.

Account deletion still snapshots export-job canonical IDs and waits for existing grants. A race with closing-account triggers can stop registration, but the captured canonical identity remains available to deletion cleanup. No reproduced account-deletion resurrection or cross-user link leak.

Fast-lane timing/laneFailed updates use a lane predicate at write time; an already changed lane is not overwritten by those writes. The frame-size health check is now executable and correct. I did not interpret a passing lane guard as an end-to-end deadline guarantee.

## Checks, scope and unfinished verification

Initial test copy: 00d6a97, including export fixes de323bd and Clarity 769bf3f. The four application files from bf6ae8b were then copied explicitly into the test copy and relevant auth/static/build checks rerun.

| Check | Result |
| --- | --- |
| All 22 scripts/*-checks.cjs | PASS |
| All 12 scripts/verify-*.cjs | PASS |
| frame-schedule-checks | PASS, 240 cases |
| next typegen | PASS |
| npx tsc --noEmit | PASS |
| npx eslint src render | PASS, no warnings |
| npx next build, default Turbopack | PASS, 38 static generation entries |
| Auth checks + TypeScript/lint/build after bf6ae8b masking changes | PASS |
| Additional actual-function/metadata/ffmpeg probes | Results above |
| Live Chrome export, PSNR and timing claims | NOT VERIFIED |

The existing TikTok Sans fallback-metrics warning remains. Default build failure from the previous review did not recur; no build workaround was required.

Environment: Node 22.23.4; clean physical copy, no actual .env or .data, founder's running .next untouched. Logs and temporary probes are retained at **/tmp/mavya-fixes-review-nHBAGT/evidence** and **/tmp/mavya-fixes-review-nHBAGT/probe**. Scripts include metadata.mjs, edge-frames.mjs, promotion.cjs, range-race.cjs, byte-budget.cjs, fast-cap.cjs, late-step.cjs, editor-audio.cjs, text.cjs, unmount.cjs, auth-masks.cjs, colour.mjs and loop-and-codecs.mjs. They are not repository changes.

The earlier automatic approval review rejected launching dedicated muted Chrome with “blocked by policy.” No permitted browser tool/installed WSL browser was available here, so this review did not repeat that launch through another mechanism. Node packet metadata and ffmpeg probes are explicitly not described as real Chrome runs.

No temporary live user, subscription, run, media row, text upload or R2 object was created. No production cleanup remains. No founder/customer writes, paid provider calls, emails, music or audible playback. I made no application changes or commits. The remaining action is Claude's review of this report and an agreed fix list.

