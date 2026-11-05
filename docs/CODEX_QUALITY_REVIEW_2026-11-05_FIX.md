# Review of uploaded-clip quality fix — 2026-11-05

**Verdict: do not ship this exact tree today.** The default QP20 path is a substantial, measured improvement. The remaining blockers concern browser-only failure handling, actual encoder fallback, untested adaptive quality, and inconsistent colour metadata in the newly selected software path. These can be addressed without reopening the hook/subtitle design or requiring direct originals in this patch.

Scope: reviewed `git diff` for the three requested files and their surrounding control flow, installed mediabunny 1.61.6, and the supplied Windows `new_*.mp4` and VMAF JSON files. Report only; no app edits or commit. `git diff --check` passes. Claude reports tsc, eslint, build and 22 check scripts passing; I did not rerun that suite. I did not drive Chrome or independently regenerate the VMAF references in this review.

## Blockers — must fix before shipping

### B1. Browser failures still silently invoke server rendering (P1)

**`src/components/export-button.tsx:92–111`**, especially **:93** and **:111**.

`browserExportSupported === false` runs the server path. An exception during browser source fetching, actual encoder initialization, encoding, GPU work or finalization is caught at :93, converted to null, and also runs the server path. Safari/non-Chromium is rejected at `src/lib/browser-export.ts:58` and follows the same route. The new `unsaved()` handling correctly protects completed files from reservation failures, but does not make export browser-only.

This directly violates the founder's requirement, regardless of whether the fallback is called a “quality” fallback. Remove automatic server submission from this flow. On unsupported browsers or exhausted browser retries, end with a clear failure/compatibility message. Supporting every browser can be a separate project; starting a server render cannot be the substitute. Do not catch cancellation as a retryable encode failure.

**Required checks:** force unsupported video/audio, reject source fetch, throw from encoder configure/encode/flush, lose the GL context; verify zero server-render POSTs and that the button becomes usable again. Completed local output must survive cloud-save failure.

### B2. The advertised encoder fallback is only a support-query fallback (P1)

**`src/lib/browser-export.ts:43–46`, `:321–341`, `:361`**.

`pictureSetting()` returns the first candidate for which `canEncodeVideo` returns true. On Chromium, installed mediabunny `encode.ts:1147–1157` uses `isConfigSupported` and immediately returns true without a trial encode. A device can accept level-5.1 quantizer configuration but fail to configure or encode the real RGBX frames. The app then never tries auto-level QP20 or software; it aborts the whole browser render (and currently hits B1).

Also, capability probing omits `latencyMode: "quality"`, whereas real initialization adds it at :327. Probe the exact intended configuration.

**Fix:** attempt actual encoding, flush and verify output for each candidate using representative canvas frames, and/or retry a fresh browser render with the next candidate after a classified encoder failure. Dispose the failed encoder/output between attempts. Preserve the demo keyframe and audio timeline. Do not retry unrelated fetch/auth errors or cancellation as encoder failures. A preflight does not eliminate the need to handle failures during the real render.

**Required checks:** first candidate reports supported but configure throws; configure succeeds but encode/flush fails; level-5.1 fails but auto-level succeeds; all QP candidates fail but software succeeds; every candidate fails. Existing tests that merely hide support do not exercise these branches.

### B3. Adaptive QP is enabled without evidence that its quality ceiling passes (P1 validation gap)

**`src/lib/browser-export.ts:28–30`, `:331–335`, `:359–361`**.

The per-frame override is implemented correctly: `CanvasSource.add` forwards the options, and mediabunny merges them after its fixed default. `packet.byteLength` is a real property. I found no API wiring bug there.

But none of the submitted new runs demonstrates this controller operating. For an 18-second run, its approximate video budget is **136 Mbps**; the measured output is only **16 Mbps**. The 3.3-second budget is larger still. Thus these tests primarily validate fixed QP20. QP24's earlier 98.8 mean VMAF was a different, original-source short-clip test, not evidence for working-copy QP24, the long clip, abrupt changes or the controller's worst windows.

The controller uses submitted-frame index `n` to assign budget while counting asynchronously emitted packets. Awaiting `picture.add()` respects backpressure but does not imply all preceding packets have been emitted. Encoder delay can make the controller see artificially low usage. It can raise **and lower** QP, so the description that it only raises is incomplete. Its 8 MiB reserve is reasonable headroom, but this remains a heuristic, not a cap; the final Blob check correctly handles overshoot.

**Fix before shipping:** either disable adaptation for this release and keep fixed QP20 plus local Download on oversize, or validate the active controller on 60/180-second actual exports: difficult opening, easy opening followed by difficult motion, hard cuts, and delayed packet callbacks. Capture QP history and worst-window quality. Keep the QP bound and final size check. Do not lower the quality ceiling to force cloud saving.

The software lane also needs a long-file test: 22 Mbps for 180 seconds is approximately **495 MB video alone**, so it cannot fit the 300 MiB save cap. This is an expected local-only result under the current policy, not a successful universal size-budget implementation.

### B4. Software output has contradictory transfer-function tags (P1)

**`src/lib/browser-export.ts:39`, `:456`, `:496–501`**.

I inspected the actual `new_clip_sw.mp4` and `new_long_sw.mp4` files. Their MP4 `colr/nclx` tags are **primaries 1, transfer 1, matrix 1** (BT.709). Their H.264 VUI explicitly says **primaries 1, transfer 13, matrix 1**, limited range (sRGB transfer). The existing `bt709()` helper rewrites the container only. The hardware sample's demuxed transfer is BT.709; software samples report `bt709/bt709/iec61966-2-1`.

This is a concrete output inconsistency in the software lane this change now promotes, not a hypothetical HDR issue. Players can choose different metadata; the supplied luma metrics do not prove playback colour matches across Windows, QuickTime and iPhone.

**Fix:** select a coherent SDR colour conversion/tagging policy, ensure container and bitstream agree, and verify that policy against the original in native players. Do not fix this by blindly changing another label without establishing the actual pixel transfer. A narrowly scoped correction is sufficient; a full HDR pipeline is not required for these SDR clips.

**Evidence command:** `node_modules/ffmpeg-static/ffmpeg -i new_clip_sw.mp4 -map 0:v -c copy -bsf:v trace_headers -frames:v 1 -f null -` reports `transfer_characteristics = 13`. Reading the six bytes after `colr/nclx` yields `(1,1,1)`.

## Should-fix

1. **Telemetry records a requested candidate, not actual encoder identity or quality history.** `src/lib/browser-export.ts:35–41`, **:459–460**; route **`src/app/api/runs/[id]/export/route.ts:135–136`**. The `hw-*` candidates do not request `prefer-hardware`; labels cannot establish hardware implementation. `prefer-software` is also a preference. The reported Mbps includes audio/container, whereas the size controller counts video packets. The suffix records only ending QP: a run that visits QP24 and returns to QP20 leaves no hint. Record requested acceleration, actual configured codec/mode/latency, start/min/max QP and frames at each QP, video bytes, total bytes, duration and app build ID. Mark actual implementation unknown unless observed. The route's bounded string validation itself looks fine; treat it as client-reported diagnostics.

2. **The last hardware bitrate lane is not validated as a general quality fallback.** **`src/lib/browser-export.ts:40–41`**. The supplied `new_clip_last` mean passes VMAF95, but its worst frame is **84.39** and fifth percentile **91.37**. That does not by itself prove a visible defect; it does require motion/worst-window review before calling it near-identical. VBR14 is unmeasured in these new results. Do not label every supported configuration as quality-approved. At least measure the remaining candidate and a different machine; a meaningful quality check remains the long-term requirement.

3. **Reservation failure can leave a real job pending.** **`src/components/export-button.tsx:153–154`**, route **:141–146**. If the server reserves the job but its response is lost, or signed-link generation fails after reservation, `unsaved()` resets local blocking without tracking the pending job. Download survives (good), but subsequent attempts can encounter the orphan until timeout. Reconcile the existing job after an ambiguous failure or make reservation/upload-link recovery idempotent. This is not a reason to re-render on the server.

4. **Comments overclaim both cause and visual equivalence.** **`src/lib/browser-export.ts:18–23`**. The explicit quality-latency test changes the former hardware CBR outcome; “hardware ignores the bitrate” without that qualifier is now misleading. VMAF95 does not mean “no visible difference.” Cite the Windows measurements as observations, and distinguish fixed-QP results from the adaptive controller. The linked earlier report did not contain these new Windows results when written.

5. **Cross-device and memory coverage is still absent.** No second laptop, integrated-only machine, Mac, or 8 GB peak-memory evidence accompanies this patch. QP20 working copies are a defensible incremental source choice for measured SDR/30 fps clips; HDR/60 fps/landscape guarantees remain out of scope and unproven. Do not market the measured Windows performance as universal. At minimum exercise software and QP initialization on another normal laptop before broad rollout.

## What the supplied artifacts establish

I independently parsed the saved VMAF JSON and inspected the corresponding media headers. These values agree with Claude's table (rounding aside):

| File | Scored frames | Mean VMAF | Worst | Fifth percentile |
|---|---:|---:|---:|---:|
| new_clip | 99 | 99.071 | 95.031 | 95.855 |
| new_long | 540 | 97.991 | 93.872 | 94.981 |
| new_clip_sw | 99 | 97.714 | 90.394 | 93.019 |
| new_long_sw | 540 | 98.027 | 90.845 | 94.983 |
| new_clip_last | 99 | 96.392 | 84.390 | 91.370 |

These cover approximately 3.3 and 18 seconds, not every frame of the originals' slightly longer durations. All measured means exceed 95. The default QP20 working-copy path is therefore worth retaining. I did not reproduce human moving-video A/B or independently establish the JSON reference alignment in this pass.

The download change at `src/components/export-button.tsx:148–154` is correct in its main purpose: publish the local Blob before reservation, preserve it on oversize/reservation failure, and return `"started"` to prevent the old post-render server fallback. The route's encoder field is modest, bounded and does not affect rendering. No regression was found in per-frame QP override or forced demo keyframe merging.

**Ship decision:** no for the current tree. Fix B1/B2, resolve B4, and either turn off adaptation or supply the B3 stress evidence. Then this is a credible incremental quality fix for the measured SDR/30 fps browser workflow. Direct originals, uncropped copies and 60 fps need not block that narrower fix; automatic server rendering and untested fallback behaviour do.

## Re-review

Reviewed the revised three-file diff on 2026-11-05, limited to the previous findings and regressions from these changes. `git diff --check` passes; Claude's reported test suite was not rerun here.

- **B1 partially fixed; one blocker remains:** `src/components/export-button.tsx:93` still falls through to server submission at **:112** when the support check returns false. This includes Chrome/Edge with unavailable WebGL, AAC or video encoding, not just Safari/Firefox (`src/lib/browser-export.ts:54–66`). Browser attempts that actually start now stop correctly on failure at button :94–98. The remaining server path still violates the founder's explicit browser-only requirement. Remove it or obtain an explicit founder exception; an intention to tell the founder is not that exception. No need to build Safari/Firefox support before making unsupported-browser failure explicit.
- **B2 resolved for actual encoder retry:** supported candidates are collected with quality latency (:42–45), each real render is tried (:243–255), and aborted/SourceError attempts stop. Sources are shared across tries. The supplied configure/encode fault-injection results address the main prior gap. Cleanup still has small nonblocking holes below.
- **B3 resolved:** adaptive QP is removed. Fixed QP20 and oversized-file local Download are acceptable for this incremental fix. No long-video size guarantee is claimed.
- **B4's measured metadata conflict resolved:** I independently inspected `f_normal`, `f_failQ`, `f_failQEncode`, and `f_failQSw`. Hardware-candidate files have container `(1,1,1)` and demux as BT.709; software fallback files have container `(1,13,1)` and explicit VUI transfer 13. The software/container contradiction is gone. This is not independent proof of identical colour appearance on all players. Conditional relabeling still infers implementation from the requested candidate; future cross-device verification should use actual encoder output metadata.
- **Diagnostics improved:** :459–461 labels whole-file Mbps and includes the seven-character build value. Confirm production actually populates that environment variable. Hardware labels still describe candidates rather than an observed implementation.
- **Lost reservation response remains nonblocking:** preserving Download and eventual expiry are sufficient for this quality patch. A temporary pending job/retry delay remains a should-fix, not grounds to re-render.

Two nonblocking retry-path issues should be cleaned up: `browser-export.ts:234–237` does not wrap a rejection from `res.blob()` in SourceError, and actual demux/decode/audio errors can also escape as ordinary errors, so some source failures still retry every encoder. Also, a throw at :432 skips the retained `VideoFrame.close()` at :436; per-attempt cleanup does not own that frame. Close it in a loop-level finally. The retry catch currently retries all non-SourceError failures (including GL/text failures), rather than only classified encoder failures. These are bounded wasted retries/resource-retention issues; the new browser-only failure branch prevents server rendering after them.

**Current decision: one remaining blocker, B1 at `src/components/export-button.tsx:93` / `:112`.** Once that path is removed or explicitly authorized by the founder, the reviewed changes are acceptable as an incremental SDR/30 fps quality fix. Cross-device, worst-window and native-player validation remain the previously recorded limitations, not newly added blockers.

## Batch 2 review

**Verdict: do not ship the whole batch yet.** The security upgrade is suitable to ship separately. Firefox's measured default improves quality; the HDR copy recipe runs, but export selection does not guarantee that recipe was used.

Scope: reviewed all seven implementation/dependency diffs and surrounding export/copy selection; report only, no implementation edits or commit. Read installed Next.js upgrade guidance. Independently parsed `ffr_clip.json` / `ffr_long.json` and inspected both MP4s; ran the current HDR detection and both separate copy commands for 0.2 seconds of the supplied synthetic HLG source with the server's actual global flags. Both succeeded at the expected dimensions with limited-range BT.709 output. `git diff --check` passes. Did not rerun Claude's full suite, browser automation, npm audit, peak-RSS measurements or human playback checks.

### Blockers

1. **P1 — automatic server submission remains, including new AAC bootstrap failures.** `src/components/export-button.tsx:93`, **`:100–112`**; `src/lib/browser-export.ts:89–95`. This is the previous B1, still unresolved. Unsupported Safari, unavailable GPU/codecs, or an AAC extension import failure returns false and submits an ordinary server export. Changing the comments to explicitly endorse Safari server export does not resolve the founder's browser-only requirement. Stop with a compatibility/retry message, or obtain an explicit founder exception. Test failed AAC import, denied WebGL, unsupported video and Safari: zero server-render submissions. Failures after browser rendering starts already stop correctly.

2. **P1 — HDR conversion is optional at export selection, so this does not yet provide reliable HDR upload export.** The changed conversion lives only in `render/server.mjs:191–193` / `render/render.mjs:109–152`; `src/app/api/runs/[id]/export/route.ts:29–30` still chooses the original whenever the master is not ready. `src/lib/server/previews.ts:46` skips copies altogether below 3 MiB and accepts existing copies without a conversion version. Thus a new short HDR upload can never reach this tone-map, an export during copy generation/failure bypasses it, and an old HDR master remains unconverted indefinitely. Server `stepArgs` has no HDR tone-map; browser original decoding uses a different, unvalidated colour path. The presence of a new recipe is not an end-to-end conversion contract. Add trusted HDR/conversion readiness and wait/retry or explicitly reject HDR when its converted source is unavailable; version/regenerate affected copies or restrict this feature to verified new copies. No need to regenerate the founder's known SDR clips. Test sub-3-MiB HDR, pending/failed generation, stale copies, and exports before/after readiness. If deliberately shipping only a best-effort copy improvement, scope the feature accordingly and keep unverified HDR export disabled.

### Findings and remaining validation

- **Next.js:** manifest and lockfile pin Next.js and eslint-config-next to 16.4.5; no unrelated dependency sweep found. The supplied advisory IDs identify real issues, and their published fixed 16.x version is 16.4.1, so 16.4.5 is outside those affected ranges: [SVG optimizer RCE](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [typed-array cache RCE](https://github.com/advisories/GHSA-673q-mjm6-r5xr), [Server Actions DoS](https://github.com/advisories/GHSA-p3m5-59mp-jv5r). This verifies the version choice, not the reported zero-vulnerability audit result or production deployment.
- **Firefox evidence confirmed:** 99 frames, mean **97.5442**, worst **90.1631**; 540 frames, mean **96.8709**, worst **90.1178**. Both files contain stereo 48 kHz AAC-LC. Their container nclx is `(1,1,1)`; header tracing found no explicit conflicting transfer/primaries/matrix declarations in the video stream. I did not independently establish source alignment, listening quality or moving-video equivalence. These are approximately 3.3/18-second samples, not long-export or Firefox 130 evidence.
- **AAC integration looks sound:** exact matching package version, compatible peer requirement, lazy registration, shared initialization promise. Mediabunny clears its negative audio-support memo on `registerEncoder`, so the initial false AAC query does not poison the subsequent check. The extension uses a Blob worker and embedded WASM: verify an actual production build under deployed CSP and fresh-cache loading, not just a bundled test harness. A support query can return true before that worker initializes. A WASM/worker error currently retries video settings unnecessarily, then stops if the browser attempt already started.
- **Firefox scope and fallback quality remain unproven:** `browser-export.ts:46–49`, `:80–87` enables every Firefox >=130 across platforms from one headless Windows 159 result. Windows Media Foundation and Apple VideoToolbox/platform behavior are not interchangeable. Trial minimum-version and current Firefox on Windows/macOS before claiming that range; qualify Linux/mobile separately. Software preference does not prove actual software implementation. Fault-inject failure of `ff-sw-40m` and test every remaining fallback's output, demo and colour tags. A successful encode at 10 Mbps does not establish acceptable quality. The existing software-vs-hardware metadata inference at `:483–488` still needs cross-device evidence.
- **HDR quality is unvalidated beyond plumbing:** `render/render.mjs:109`. The synthetic SDR-to-HLG fixture has no representative highlight range and supplies no PQ evidence. Average luma cannot choose a generally correct tone mapper. Before enabling HDR export, require real iPhone HLG/Dolby Vision material and PQ/highlight/saturated-gamut fixtures, moving-video comparisons in native players, and container plus VUI inspection. `desat=0` deserves explicit saturated-highlight checks. Do not claim preservation of HDR: this produces SDR and discards HDR dynamic range/metadata by design.
- **Memory evidence has limited scope:** sequential passes and input `-threads 1` are correctly wired, including with the server's earlier `-threads 2`; the later input option wins. The scratchpad measurement harness includes the same global `-filter_threads 1` as production. No argument mismatch found. Child-process RSS of 332–356 MB alone does not prove safety in a 512 MB container: include the Node process and cgroup peak, audio, real 4K60 10-bit input, and repeated jobs. Both passes share the existing 15-minute controller deadline. Long HDR clips can hold up the single export queue; measure this before rollout rather than increasing concurrency.
- **Tests miss the new paths:** unchanged `scripts/verify-previews.cjs` exercises SDR `previewArgs`, not `isHdr`/HDR `previewRuns`. Add reproducible HLG/PQ detection, two-pass input-thread checks, SDR argument identity, real short HDR encodes, and Firefox AAC load/failure/fallback checks. The submitted passing suite does not by itself validate these additions. Existing retained-frame cleanup and broad retry issues from the prior re-review remain nonblocking follow-ups.

**Ship gate:** fix B1 and close or explicitly gate the HDR source-selection gap. Keep security deployment independent. Firefox can be a measured Windows rollout with honest version/platform scope; broad Firefox and HDR quality claims require the evidence above.

## Batch 2 re-review

**Verdict: one blocker remains, HDR fail-open source selection.** The founder's explicit exception authorizes server backup for unsupported browsers, including failed AAC bootstrap; previous B1 is closed. Legacy HDR copies are an acknowledged accepted limitation for this review, not a renewed blocker.

- **P1 — `src/lib/server/previews.ts:75` and `src/app/api/runs/[id]/export/route.ts:31`: unconverted HDR still reaches export.** Fifteen minutes of upload age is not evidence that a source is SDR or safe to export. After that threshold a missing master unconditionally selects the original, even for newly uploaded HDR whose copy failed. Worse, any thrown source lookup error immediately selects the original through `.catch(() => "original")`, bypassing even the 15-minute wait. The reported Chrome measurement now establishes the consequence: flat HDR originals (Y 72.5 versus 101), not just a theoretical colour-path difference. Preserve an explicit preparation/unavailable error for HDR or unknown sources; permit original fallback only for positively identified SDR, or add a validated tone-map in the original-render path. The founder's server-backup exception does not authorize silently degraded HDR output. Test an HDR upload with no master at 1 and 16 minutes and thrown R2 HEAD/source lookup; none should return a raw original to an unconverted export path.
- **Verified improvements:** small uploads now request copies, both source/spec lanes receive the same preparation check, and `ServerSaid` preserves the preparation message in the browser UI. A read-only VM test of the actual transpiled `exportSource` returned `wait` with one copy request at one minute, but `original` with zero copy requests at sixteen minutes. This also means a first export of an older missing-copy upload does not request regeneration here. Missing LastModified defaults to zero and takes that same fallback.

Report-only re-review of the follow-up diff and surrounding paths; no implementation edits or commit. `git diff --check` passes. Full checks were not rerun; prior real-HDR quality, platform and memory validation limits remain as recorded.

## Batch 2 final

**Ship.** Verified that `exportSource` now returns only `copy` or `wait`, requests preparation when the master is missing, and has no age-based original fallback; route `inputLink` maps lookup failures to `wait` and returns only the master URL for working-copy video sources. The unused LastModified change is reverted. This closes the remaining HDR fail-open blocker; waiting during a render outage is the explicitly accepted behavior. The founder's server-backup exception and accepted legacy-copy limitation stand. Previous real-HDR, cross-platform and memory validation limits remain; this verdict does not establish universal HDR colour fidelity or Firefox-version coverage. Report-only inspection; no implementation edits or commit. `git diff --check` passes; Claude reports all checks/build passing, which I did not independently rerun.
