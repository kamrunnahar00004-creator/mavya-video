# Codex: brutal quality check of uploaded clips in the exported video (2026-11-05)

The founder is sure that uploaded clips come out of the export looking worse than what was uploaded. The goal: **the downloaded video must preserve as much of the original uploaded clip as possible.** Check the whole path, measure it, and say exactly where quality is lost and what the fix is.

**The target (founder, 2026-11-05):** an uploaded clip in the downloaded video must be almost the same as the original. At the least, a human eye must not see any difference when the two play side by side at 1080x1920. Treat that as "visually lossless". Measure it with VMAF of 95 or more against the original at the export size, plus a side-by-side look at still frames and at motion. If VMAF can't be built, use SSIM Y of 0.985 or more and PSNR Y of 42 dB or more. Every recommendation must say whether it reaches that target, with numbers.

**Report only. Do not change code, do not commit, do not push.** Write `docs/CODEX_QUALITY_REPORT_2026-11-05_UPLOADED_CLIPS.md`.

## The path an uploaded clip takes

1. **Upload.** `uploadFile` in `src/lib/client.ts`: the original file goes to R2 as `media/<id>` unchanged (signed PUT, no browser re-encode). Check that this is true.
2. **Copies made on the render server.** `requestPreview` in `src/lib/server/previews.ts` asks `render/server.mjs` `makePreview`, which runs `previewArgs` in `render/render.mjs`. One decode, two encodes:
   - `media/<id>.p480.mp4`: short side 480, crf 26, at most 30 fps. The editor and phone preview play this (`?preview=1`, `src/lib/media-preview.ts`).
   - `media/<id>.v1080.mp4`, the "working copy": centre 9:16 crop, `scale=1080:1920`, libx264 `veryfast`, `-tune zerolatency`, single thread, crf 18, `-fpsmax 30`.
   - Files under 3 MB get no copies.
3. **Export.** `inputLink` in `src/app/api/runs/[id]/export/route.ts` gives every demo clip the **working copy** when it exists, otherwise the original. The hook always uses its own file. This applies to both lanes, because the browser lane gets the same spec (`mode: "sources"`).
   - **Browser lane** (`src/lib/browser-export.ts`, Chrome and Edge): decode with mediabunny, draw with WebGL (look, zoom, texts), encode with the browser's own H.264 encoder. It asks for `Quality({ bitrate: 10e6, bitrateMode: "constant" })` and falls back to variable 14 Mbps.
   - **Server lanes** (Vercel fast lane `src/lib/server/fast-export.ts`, Render worker `render/render.mjs`): pieces at ultrafast crf 12, then the join at ultrafast `zerolatency` crf 17.
4. **Demo part.** The demo part of each export is copied out without re-encoding (`exports[].demo`).

So an uploaded clip is encoded **at least twice** before the user downloads it: once for the working copy and once in the export.

## What Claude measured (founder's real files, production, 2026-11-05)

Source: `media/e8d57b5a-48c4-48e2-91ae-3a0038edacef.mov`, an iPhone clip at 3840x2160 rotated −90, 30 fps, 46.6 Mbps, 3.37 s. Export: job `fca9657b-6e2d-44f1-9fff-155bdacc03b2` → `media/e06ae99a-e8ef-4d5e-8e5a-de5c18d96e8d.mp4`, browser lane, made 2026-11-05 11:43 UTC. That is about 11 hours after `08083ef` ("steady 10 Mbps") went live.

The clip is the last demo clip, with no look changes (in 0, out 2.035). It starts at export frame 473. Frames were aligned exactly; the caption area (top 700 px) was cropped out. All copies were scaled to 1080x1920 and compared on 50 frames.

| Compared to the original | PSNR Y | SSIM Y |
| --- | --- | --- |
| Working copy `v1080` (25.3 Mbps) | 43.1 dB | 0.988 |
| **Downloaded export** | **35.1 dB** | **0.960** |
| Export vs working copy alone | 35.5 dB | 0.966 |
| Reference: x264 medium straight from the original at 5.4 Mbps | 38.7 dB | 0.969 |
| Reference: x264 medium at 10 Mbps | 40.7 dB | 0.979 |
| Reference: x264 medium at 20 Mbps | 43.0 dB | 0.987 |
| Editor preview `p480` (what the user sees while editing) | 32.3 dB | 0.888 |

Findings so far:

- **The export is 5.3 to 5.6 Mbps, not 10 Mbps.** Both files of the last job measure that way: the video at 17.8 s / 5.44 Mbps and its demo at 16 s / 5.32 Mbps. The `08083ef` commit message says the founder's hardware encoder gave 5.4 Mbps when asked for variable 10 Mbps, and that constant 10 Mbps gave 10.4 Mbps in Chrome. Production still gives 5.4 Mbps. Either the encoder ignores the constant-bitrate request, or the measurement in that commit was not on the founder's encoder, or the founder's tab ran old code.
- The final encode loses most of the quality (about 8 dB). The working copy costs about 0.1 dB against a direct 20 Mbps encode, but it is still an extra generation.
- The export is full range (`yuvj420p`, pc, Y 0 to 255) and tagged that way. The colours match after range conversion. Check whether full range is the right output for TikTok, Instagram and YouTube uploads, and for QuickTime and phone players.
- The editor preview is 480p crf 26 by design (founder 2026-11-03: smoothness over quality). This may be part of what the founder sees as "downgraded".

The measurement files are in `/tmp/claude-1000/-home-farhan-listinglens/77a52ec3-36ea-4781-bab1-ef9ec234d177/scratchpad/q` (original, v1080, p480, export, demo, x264 references). Download fresh copies from R2 if they are gone.

## Founder constraints (2026-11-05)

- **The export stays in the user's browser.** A server render was rejected: a 25 s video took 2 min 26 s on the Vercel fast lane (job `82d4a31d`, Nov 3), and paying per export does not scale. Hosting is flat: Vercel Pro and Render's $7 plan (512 MB, half a CPU). The Render server can keep doing the one-off copies made per upload.
- **It must work on any normal laptop**, not just the founder's (Windows laptop, Intel UHD plus RTX 4060, Chrome 156). Quality must be the same on every laptop; only the speed may differ.
- The target is the one above: visually lossless against the original.

## Claude's plan (nothing is built yet)

1. **Ask the encoder for quality, not a bitrate.** Use WebCodecs `bitrateMode: "quantizer"` (H.264, a fixed QP of about 16 to 18, through mediabunny's `Quality({ quantizer, bitrate })`). Fallback where it isn't supported: VBR at 25 to 40 Mbps. Use `latencyMode: "quality"`, High profile, level 5.1 or 5.2 so the bitrate is allowed.
2. **The export checks itself, so it holds on any laptop.** After encoding, decode about 10 frames of the output and compare them on the GPU with the same frames drawn before encoding (PSNR or SSIM, in about 1 s). If they fall below target, encode again with `hardwareAcceleration: "prefer-software"` (Chrome's built-in OpenH264, the same on every machine) at a high bitrate. If that is still below target, or too slow, fall back to the server lane as today.
3. **One encode, not two.** The browser reads the original upload instead of the 1080p working copy when `VideoDecoder` supports its codec (H.264; HEVC on most hardware). Otherwise it reads a better working copy: crf about 12, no `zerolatency` if the 512 MB Render server allows it, the source frame rate kept. The working copy is made once per upload, so it adds no cost per export.
4. **Keep 60 fps** when the sources are 60 fps.
5. **Show Download at once.** Offer the file as soon as rendering ends, while the larger upload (about 60 to 100 MB for 25 s) finishes in the background.
6. Later, maybe: copy clips without re-encoding when nothing is drawn over them and they already match the export format.

Questions for you:
- Does Chrome honour `quantizer` mode for H.264 on hardware encoders (Media Foundation on Windows, VideoToolbox on Mac, VA-API) and on OpenH264? What does each really produce at QP 16 to 18 on the founder's clips? Measure on the founder's laptop if you can run Chrome there.
- Can a hardware encoder ignore a QP the way it ignored the bitrate (`08083ef`: asked for constant 10 Mbps, delivered 5.4 Mbps)?
- Is OpenH264 in Chrome good enough to reach the target at all, at what bitrate, and how fast on a mid-range laptop for a 25 s and a 60 s video at 1080x1920?
- Is the self-check sound? Which frames, which metric, which threshold, its cost, and its false passes (static frames, frames covered by text).
- Memory and time of decoding 4K originals in the browser on an 8 GB laptop. Rotated iPhone files, HEVC, HDR/HLG (10-bit BT.2020): tone-map or not, and how the WebGL draw handles it.
- Upload size and time at these bitrates; R2 and the size limits in `src/app/api/runs/[id]/export/route.ts` (300 MB) and `render/limits.mjs`.
- Anything better that stays in the browser and works on any laptop.

## What to check, brutally

1. **Reproduce the numbers above** on this clip and on at least two more of the founder's recent uploads, including a 60 fps clip and a landscape clip if any exist (Supabase `media`, newest `video/%` rows; matching `export_jobs`). Check every claim in this file. Do not take any of them as true.
2. **Find every place the clip loses quality** from upload to download:
   - resolution: crops, scales, the scaler used, upscaling of small sources, the rotation path;
   - frame rate: `-fpsmax 30` and the 30 fps export, and how 60 fps and VFR sources are dropped;
   - bit depth and colour: HDR/HLG/Dolby Vision iPhone clips (10-bit HEVC, BT.2020) — are they tone-mapped, clipped or washed out? Range, matrix and primaries tags through every step;
   - chroma, the WebGL draw (texture filtering, sRGB/linear handling, premultiplied alpha, canvas colour space);
   - each encode: encoder, preset, rate control, GOP, B-frames, `zerolatency`;
   - the demo copy-out.
3. **Why is the browser export 5.4 Mbps?** Find out what `CanvasSource` with `bitrateMode: "constant"` actually passes to `VideoEncoder.configure`, what Chrome's Windows hardware encoder (Media Foundation) does with it, and whether `canEncodeVideo` can return true for a configuration the encoder then ignores. Check the bitrates of the founder's exports before and after `08083ef`.
4. **Review Claude's plan above, brutally**, and measure it. Say whether each step reaches the target, what breaks, and what you would do instead.
5. **Is anything else lossy that the founder would notice?** For example: sharpness lost in the zoom path, banding in gradients, the `p480` preview shown at full screen, or the My files player.

## Report back

Report in plain English. Write a table per finding: what you measured, the evidence (commands and numbers), the severity, and the fix you recommend. Put a ranked list of fixes at the top, so the founder knows what to do first.
