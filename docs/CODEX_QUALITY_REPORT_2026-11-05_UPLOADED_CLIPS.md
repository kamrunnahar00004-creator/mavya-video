# Uploaded iPhone clip quality: independent review, 2026-11-05

The founder is right. The downloaded file loses substantial detail after the working copy. The browser export is the first thing to fix. The hook and subtitle styling do not need redesigning.

## Ranked build order

1. Instrument the actual browser encode and select settings by measured picture quality on the founder's clips. Test QP 16/18 and high-bitrate hardware/software paths; record the selected configuration, build ID, output bytes, timestamps and metrics. Do not ship another bitrate-only fix based on `isConfigSupported`.
2. Add a browser-only software encoder fallback with bounded memory, and a meaningful quality gate. Try the browser's software encoder first; if insufficient/unavailable, evaluate a bundled WASM encoder. A server fallback violates today's requirement. No measured browser configuration has yet demonstrated the target here.
3. Read supported originals directly, preserving rotation and source detail through crop/zoom. Retain a high-quality, uncropped, explicitly colour-managed compatibility copy for unsupported sources. Validate final output against the original, not just the canvas.
4. Make SDR/HDR handling explicit and consistent; then preserve 60 fps end to end. Validate on an 8 GB laptop, Windows integrated graphics, Mac and Linux. These are necessary coverage items, not proven fixes for these particular SDR/30 fps clips.
5. Keep local Download independent of cloud saving, including reservation failures and large files. Most of this behaviour already exists. Defer stream-copy splicing until the basic path passes.

## Scope and confidence

Report only: no application code changed, no commit. I traced local code and installed mediabunny, queried Supabase read-only, downloaded additional media from R2, and measured with `node_modules/ffmpeg-static/ffmpeg` (which includes libvmaf). Chrome on the founder's Windows laptop is unavailable here. Claude's Windows encoder results had not arrived when this report was written. Hardware QP behaviour and mid-range laptop throughput remain unmeasured; CPU x264 results below are explicitly not WebCodecs/OpenH264 results.

Six distinct supplied/recent iPhone originals inspected (`e8d57b5a`, `eb30f3a6`, `61cb4a63`, `5b684b76`, `ef3f78a1`, `d57536dd`) are all H.264 High, 8-bit limited-range BT.709, 3840×2160 coded, rotation −90°, 30 fps, displayed portrait. Their video rates are 44.50–48.26 Mbps. None is HDR, 60 fps or displayed landscape. I have not established that such files do not exist elsewhere in the account. Those requested cases remain a coverage gap. Read-only queries fetched the newest 60 media rows and 60 export-job rows; only 16 jobs were returned. I inspected stills; I cannot claim a human side-by-side moving-video playback test at native size from this environment.

## Independent measurements

Reference: ffmpeg autorotates the original, scales to 1080×1920 using its default scaler, normalizes both inputs to limited-range yuv420p, and matches frame indices. Primary ROI is `crop=1080:1220:0:700`, first 50 source frames. Export starts at frame 473, confirmed from the persisted job and `plan(spec)`. Full-range export conversion is explicit; comparing raw full-range and limited-range values would be invalid. These are ROI scores, not full-frame VMAF scores.

| Finding / comparison against original | Measured evidence: VMAF / PSNR Y dB / SSIM Y | Severity | Fix and target verdict |
|---|---|---|---|
| Primary working copy | **99.44 / 43.26 / .98810**, 25.344 Mbps | Small but real loss | Passes numerical target for this ROI. Improving it alone cannot repair the final encode. |
| Primary downloaded export | **89.10 / 36.93 / .95827**, 5.440 Mbps | Critical | Fails. Change and verify the browser encode. |
| Primary editor p480, upscaled | **70.23 / 32.66 / .91359**, 1.031 Mbps, 480×854 | Expected proxy degradation | Keep smooth editor proxy; use original/output for quality review. A sharper editor does not improve downloads. |
| Supplied x54 reference | **95.91 / 38.87 / .97027**, actual 5.091 Mbps | Diagnostic | Passes VMAF threshold on this ROI, fails stricter PSNR/SSIM values. Demonstrates that 5 Mbps alone does not explain the browser result. |
| Supplied x10 reference | **98.72 / 40.89 / .97974**, actual 9.980 Mbps | Diagnostic | Numerically passes VMAF; not proof of visual indistinguishability. |
| Supplied x20 reference | **99.71 / 43.30 / .98728**, actual **21.625** Mbps | Diagnostic | Passes all numerical thresholds here. Not a tested browser setting. |
| Second original `eb30f3a6` → working, first 150 frames | **99.37 / 42.28 / .98717** | Small loss | Passes numerical target in measured region. Export has speed, contrast, saturation and zoom edits; raw-original comparison there would conflate deliberate edits with degradation. |
| Third original `5b684b76` → working, first 40 frames | **98.28 / 44.25 / .98403** | Small loss | Passes VMAF; narrowly misses SSIM alternative. |
| Third original → export, frame 307, 40 frames, lower ROI | **81.96 / 37.29 / .94756** | Critical | Fails. ROI is `crop=1080:520:0:1400`, excluding the central subtitle. Same working copy in that ROI: **97.30 / 44.50 / .98382**. |
| Fourth original `d57536dd` → export, frame 353, 45 frames, same lower ROI | **87.11 / 35.45 / .92408** | Critical | Fails on another unadjusted clip. |
| CPU x264 medium, direct original, fixed QP 18 / 16, first 50 frames | QP18: **99.94 / 46.33 / .99041**, **34.567 Mbps**. QP16: **99.94 / 47.69 / .99241**, **45.040 Mbps** | Useful reference only | Both pass here. These numbers cannot be attributed to hardware encoders or Chrome OpenH264. Fixed QP can create much larger files than planned. |

The request's approximate PSNR/SSIM numbers are directionally confirmed, but not reproduced exactly: my primary export is 36.93 dB rather than 35.1; preview SSIM is .9136 rather than .888. Treat them as different measurement protocols, not interchangeable scores. The supplied reference files' encoder settings were not independently recovered; their actual rates above were verified. `x54` is not a measured 5.4 Mbps file; `x20` is not exactly 20 Mbps.

VMAF 95 is an acceptance proxy, not a guarantee of an invisible difference. Here even the 5.1 Mbps CPU reference passes it while failing the request's alternative PSNR/SSIM thresholds. Require native-size visual review as requested, plus per-frame/tail statistics. Primary export per-frame VMAF ranges down to **55.18**, despite a mean of 89.10. Do not average away bad motion or cut recovery. Do not translate a difference between two separately encoded references into the working copy's incremental cost: the request's “about 0.1 dB” claim is not a controlled generation-loss measurement.

## Where the quality goes

| Finding | Evidence / measurement | Severity | Recommended fix; target status |
|---|---|---|---|
| Upload preserves file bytes in code | `src/lib/client.ts:uploadFile` PUTs `body: file`, no canvas/transcode. Original R2 media remains separate from proxies. No founder-local checksum was available. | None found | Keep. Code verifies no upload encode; byte identity against the founder's local file is not independently proven. |
| Working copy is actually used for export | `inputLink(..., working)` and `s.id !== "hook"` in export route; persisted source spec contains `.v1080.mp4`. Comments saying “always original” in previews helpers are stale. | High | Explicit source/copy choice and provenance. Original input removes a generation; final target still depends on renderer/encoder. |
| Working copy permanently crops before user zoom/pan | `previewArgs`: centre 9:16 crop then default `scale=1080:1920`, even for smaller sources. | High for landscape/reframing/zoom | Preserve uncropped source geometry. A 65% zoom currently magnifies a 1080 working copy; direct 4K has more usable detail. Impossible to recover discarded pixels by increasing bitrate. No landscape metric obtained. |
| Frame rate capped twice | Working and p480 `-fpsmax 30`; `render/constraints.json` fixes export 30; route and worker validation depend on it. | High for 60 fps | Preserve source timing and choose output fps across route, scheduler, overlay timing, encoder config, demo and validators. No 60 fps target verification yet. VFR must use timestamps, not frame-number guesses. |
| Browser scaling differs from reference | GL texture uses LINEAR min/mag, no mipmaps/multitap downsampling; zoom/crop samples texture directly. ffmpeg uses a different scaler. | Medium; greater for direct 4K | Test renderer alone against a canonical crop/downsample; consider quality downsampling for strong minification. More bitrate cannot fix aliasing already in canvas. No measured pass yet. |
| SDR colour has undocumented conversions and relabeling | GL uses RGBA UNSIGNED_BYTE with no explicit colour-space selection. `bt709()` scans bytes for first `colr/nclx` and changes only transfer to 1; not a pixel conversion. Source/working limited BT.709, export full-range BT.709 by demuxer. | High for portability; HDR unverified | Define actual SDR pixel conversion and matching container AND H.264 VUI metadata. Parse boxes; do not relabel sRGB as BT.709 and assume equivalence. Full range is not intrinsically lost detail; verify player agreement before blaming it. |
| HDR path has no explicit tone map | No tone-map/gamut-map in working-copy ffmpeg filters or browser shader; 8-bit working and RGBA path cannot preserve a 10-bit HDR original. | Critical for HDR sources | Deliberate SDR tone/gamut mapping with a defined reference, or separate HDR-preserving path. SDR export cannot look identical to HDR across arbitrary displays. These actual samples are SDR, so HDR does not explain their failure. |
| Repeated chroma/bit-depth conversion | Original/working 4:2:0 → browser RGB → final H.264 4:2:0; HDR would additionally lose precision. Premultiplied blending applies to text, video sets unpack premultiplication false. | Medium | Measure colour/text-edge fidelity separately. No evidence that alpha is the main defect on these opaque clips. |
| Demo extraction adds no encode | `EncodedVideoPacketSource` remux. Extracted Annex-B streams: full **12,104,997 bytes**, demo **10,622,007 bytes**; demo is an **exact byte suffix** of full video. | None | Keep. Target failure is inherited from export, not introduced by demo extraction. |
| Server lanes re-encode pieces and join | `PIECE_OUT` ultrafast CRF12; final ultrafast zerolatency CRF17. | Irrelevant as proposed solution | They are additional lossy encodes and violate browser-only constraint. Do not use as quality fallback. |
| Preview versus downloaded file | Editor/run-preview explicitly call `previewOf`; download dialog uses returned Blob directly. | Medium perceptual confusion | Use original/export when assessing fidelity. No need to redo hook/subtitle appearance. My-files component coverage is not exhaustive. |

The original 4K-to-1080 resize and intended 9:16 crop are part of the agreed comparison, not avoidable loss relative to a full 4K frame. For portrait originals here autorotation is necessary before resize. Browser original selection must test actual decoding, display dimensions, rotation, and first-frame colour; codec-name support alone is insufficient.

## Why 5.4 Mbps? What is established

Installed mediabunny `encode.ts` builds candidates with the actual bitrateMode and bitrate. Current `Quality({bitrate:10e6, bitrateMode:"constant"})` passes **10,000,000 / constant** into the configuration; fallback is 14,000,000 / variable only when the capability probe fails. `CanvasSource` uses this candidate at real encoder initialization. High profile is already generated by `buildVideoCodecString`; adding “High profile” is not a new fix. No application code here silently halves bitrate.

On Chrome, installed `canEncodeVideo` returns true from `VideoEncoder.isConfigSupported` without encoding a test frame (its real encode probe is Firefox-only). True means supported configuration, not achieved bitrate, quality, correct decoded pixels, or sustained throughput. An accepted poor encode never triggers the current fallback.

| Export creation UTC / relation to commit | Actual video Mbps | Evidence and conclusion |
|---|---:|---|
| Nov 4 22:23:56, before `08083ef` | 5.505 | `3fff02f1…mp4` |
| Nov 5 00:26:50, before commit | 5.368 | `d176ba61…mp4` |
| Nov 5 01:48:58, after commit | 5.368 | `5e6771d4…mp4` |
| Nov 5 06:18:01, after commit | 5.454 | `d92f661c…mp4` |
| Nov 5 11:43:40, after commit | 5.440 | `e06ae99a…mp4`; demo 5.321 |

Commit time is Nov 5 **00:50:54 UTC**, not proof of deployment or client bundle version. These production files show no bitrate improvement after the commit; they do not prove a hardware driver ignored CBR. Missing evidence: actual configured candidate, fallback selected, encoder implementation, browser build and loaded app build. Require Claude's Windows test plus telemetry on a newly exported production file. Aggregate bitrate can also be below a requested target without establishing nonconformance; quality is the product requirement.

## Brutal review of Claude's plan

| Step | Review and required correction | Does it reach the target? |
|---|---|---|
| 1. QP16–18 / 25–40 Mbps | Sensible experiment, not a universal setting. Use `Quality({quantizer, bitrate})`; mediabunny creates quantizer config without bitrate and supplies **per-frame `avc.quantizer`**. Bitrate is fallback, not a simultaneous cap. Log selected candidate with `onEncoderConfig`. Quality latency is useful, but does not turn an encoder into x264 medium. Do not force level 5.1/5.2 unnecessarily: choose a supported level for resolution, fps and rate. | CPU reference passes at 34.6–45.0 Mbps. Windows/Mac/Linux QP outcome and rate unknown. |
| 2. Ten-frame self-check, one second, software retry then server | Reject as a guarantee. Canvas comparison detects final encode loss only; any pre-canvas damage is invisible. Ten still frames miss cuts, fast motion and temporal smear. GPU SSIM/PSNR requires validated colour/range and timestamp alignment. Decode cost includes seeking from preceding keyframes; GPU readback/synchronization also costs time. “One second” is unmeasured. Server escape is forbidden. | No measured pass. OpenH264 is not a universal guaranteed software implementation, and `prefer-software` is a hint. |
| 3. Original when supported; CRF12 fallback | Right direction. Requires incremental download/decoding and uncropped fallback; do not decode every original into memory together. CRF12 still does not restore source fps/HDR/geometry if the old preprocessing remains. Removing zerolatency can reintroduce lookahead memory: existing comment records 671 MB versus 298 MB on the 512 MB worker. Version copy keys/metadata; existence-only cache would otherwise keep old copies forever. | Existing working copies already score 98–99 VMAF in these regions. This alone cannot repair 82–89 VMAF final output. New copy settings unmeasured. |
| 4. Preserve 60 fps | Correct, but not one encoder flag. Needs all changes in the frame-rate finding above and a motion test. Budget roughly twice the frame work. | Untested; no 60 fps sample found in inspected set. |
| 5. Download immediately | Mostly built: `setDone(blob URL)` occurs before demo/main PUT. Still waits for local-job reservation; reservation failure can lose access to an already rendered file and trigger server fallback. Set local result independently. | UX improvement only; changes no pixels. |
| 6. Stream-copy unchanged clips | Highly constrained. iPhone samples are 4K rotated; output is 1080 portrait with subtitles. Size/profile/parameter sets, colour, keyframe trims, timestamps and audio must all match. | Cannot solve this actual export. Defer. |

The [WebCodecs specification](https://www.w3.org/TR/webcodecs/) defines acceleration preferences as hints and does not make a support query a fidelity measurement. The [AVC registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/) defines per-frame quantizer values 0–51. Neither promises identical pictures from different encoders. Unsupported/ignored options and implementation bugs require measurement, not an assertion that QP can never be ignored.

Current [Chromium OpenH264 implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/video/openh264_video_encoder.cc) configures medium complexity and camera realtime usage, sets bitrate rate control, and rejects external bitrate mode. That source is evidence against assuming software QP support; it is not proof of the founder's exact Chrome build. Measure initialization, emitted frames, achieved quality and speed. `prefer-software` alone does not establish “the same on every machine.” No credible 25 s/60 s mid-range runtime can be inferred from these ffmpeg runs.

## Quality gate that is worth building

First calibrate with a deterministic browser test harness. Feed the **same rendered frames** to each candidate encoder and retain small reference samples. Separately test original → renderer, then renderer → encoded output; measure original → final for neutral clips. Match actual presentation timestamps; normalize colour consistently. Do not compare edited brightness/zoom against an unedited original.

For production, stratify by **each clip**, cuts, early post-cut prediction recovery, motion and fine texture. Sample short consecutive windows, not ten global stills; mask known subtitle bounds and retain non-text texture regions. Check whole-frame renderer fidelity separately with matching overlays. Use per-window PSNR Y ≥42 and SSIM Y ≥.985 as conservative gates only after calibration against offline VMAF ≥95 and native-size human motion review. No finite sparse sampling proves every frame is good. Ten frames can be a cheap rejection screen, never the full acceptance argument. Benchmark cost on 8 GB hardware before promising one second.

Try a short representative encode before rendering the whole timeline. If hardware fails, retry with a measured browser software path; avoid automatically rendering the full video two or three times. For a software WASM fallback, prove acceptable fidelity and speed first, use a worker, backpressure and disk-backed/streaming I/O where available. x264 references establish achievable H.264 fidelity, not WASM performance. Until this is validated, “any normal laptop, only speed differs” remains an unfulfilled requirement rather than a property of the plan.

## Memory, upload and limits

One 3840×2160 frame costs **11.9 MiB** as 8-bit 4:2:0, **31.6 MiB** as RGBA; 10-bit planar storage commonly doubles the former. Decoder reference surfaces multiply that. One 1080×1920 RGBA frame is **7.9 MiB**. A 60-second 48 kHz stereo float mix alone is **22.0 MiB**, excluding decoded source audio and temporary buffers.

Current export fetches **every source as a full Blob concurrently**, keeps inputs alive through completion, decodes whole audio files, writes full output to `BufferTarget`, and builds a second in-memory demo. Direct-original selection without changing this design can increase memory and download time sharply. An 8 GB installed-RAM figure is not a browser memory budget. Download only selected clips/ranges, limit decoder queues, close inactive tracks, and avoid duplicate output buffers. Actual browser peak memory and thermal throughput remain unmeasured.

| Video rate | 25 s main / 60 s main, decimal MB | Main upload at 10 Mbps uplink, ideal seconds |
|---|---:|---:|
| 25 Mbps | 78.1 / 187.5 | 62.5 / 150 |
| 40 Mbps | 125 / 300 | 100 / 240 |
| 45 Mbps (measured CPU QP16 approximately) | 140.6 / 337.5 | 112.5 / 270 |

AAC adds about 0.5/1.2 MB. Demo uploading adds almost another video's worth for a short hook; the current code uploads demo first, sequentially. Thus “60–100 MB for 25 seconds” does not cover 40 Mbps, let alone QP16 here.

Route main/demo cap is **300 MiB each**, worker input cap 300 MiB per file and 600 MiB per job; timeline limit is **180 seconds**. At 60 seconds the per-file ceiling is about **41.94 Mbps including audio/container**, while at 180 seconds it is only **13.98 Mbps**. A 40 Mbps 60-second file narrowly fits, a 45 Mbps file does not. R2 is not the bottleneck here; app admission is. Raising quality needs browser-specific size handling, streaming output and upload policy; do not blindly raise worker limits on a 512 MB service. Local Download must remain available even when cloud saving is too large. None of these UX/limit fixes independently improves measured image quality.

## Reproduction evidence

Artifacts and scripts are in `/tmp/mavya-quality-review/` and `/tmp/mavya-quality-{measure,more,bottom,qp}.py`. Raw Supabase dumps stay in temporary storage; signed URLs/credentials are deliberately omitted here. Input originals/export/demo and supplied references remain in the request's `scratchpad/q` directory. Additional downloads are in the temporary review directory.

Representative commands (F is `node_modules/ffmpeg-static/ffmpeg`; `A` is original, `B` test):

```sh
$F -hide_banner -i "$A"                         # stream geometry, rate, rotation, colour
$F -hide_banner -filters                       # libvmaf, psnr, ssim available
# Each branch uses trim=start_frame=S:end_frame=S+N,setpts=PTS-STARTPTS,
# scale=1080:1920:in_range=auto:out_range=tv,format=yuv420p,crop=1080:1220:0:700
# Then independent psnr, ssim, libvmaf branches with per-frame logs.
python3 /tmp/mavya-quality-measure.py
python3 /tmp/mavya-quality-more.py
python3 /tmp/mavya-quality-bottom.py
# CPU comparison only; original autorotation is enabled by default:
$F -i "$A" -an -vf scale=1080:1920 -frames:v 50 \
   -c:v libx264 -preset medium -threads 2 -qp 18 cpu-qp18.mp4
# Exact demo check: extract video with -c:v copy -bsf:v h264_mp4toannexb,
# then test full_stream.endswith(demo_stream).
```

For two additional clips, the primary top-700 mask left central subtitles in the ROI and produced contaminated scores (77.63 and 77.81). Those are deliberately not reported as compression measurements; the clean lower-ROI results are used above. This is a concrete demonstration of why Claude's self-check must know where text is.

Outstanding evidence for Claude: Windows per-candidate output files and actual config; native-size motion A/B; 60 fps, displayed landscape and HDR samples; bounded-memory/throughput tests on an 8 GB laptop; Safari/Linux browser-only fallback coverage; exact production bundle provenance. None should be filled in with assumed numbers.
