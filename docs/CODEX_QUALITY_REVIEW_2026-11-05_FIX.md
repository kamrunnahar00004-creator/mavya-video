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
