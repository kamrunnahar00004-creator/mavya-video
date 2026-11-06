# Codex: verify that exported colours match the editor (2026-11-06)

The founder wants exposure, contrast and saturation in the exported video to match what they set and saw in the editor. Clips with no look changes must match the original.

**Verify only. Do not change code, commit or push.** Write `docs/CODEX_REVIEW_2026-11-06_LOOK_MATCH.md` with a verdict.

## The export

Production job `9bec7785-cf21-47d8-8381-f6e480a67219` (browser lane, encoder `hw-qp20 21.1mbps-file e2edca9`) → `media/cfda7e88-a43c-42d9-8c6e-ddd9d542d216.mp4`. Its spec is in Supabase `export_jobs.payload.spec`. The looks set in the editor:

| Clip | Source | Look |
| --- | --- | --- |
| 1 hook | `media/b953847c-...mp4` (Kling, 720x1280, 24 fps) | brightness 10, contrast 6, zoom keyframes 11 to 23 |
| 2 | `eb30f3a6...v1080.mp4` | contrast 2, saturation 4, zoom keyframes 0 to 65, speed 1.15 |
| 3 | `4cb5a8e6...v1080.mp4` | contrast 3, saturation 4, speed 1.1 |
| 4, 5, 7 | `5b684b76`, `d57536dd`, `e8d57b5a` v1080 | none |
| 6 | `61cb4a63...v1080.mp4` | brightness 5, contrast 23, speed 1.15 |

Local copies of every source, and a caption-free Chrome re-export of the same spec made with the same code (`clean.mp4`, overlays removed), are in `C:\Users\farha\AppData\Local\Temp\mavya-enc` (`/mnt/c/...` in WSL). The production file is at `/tmp/claude-1000/-home-farhan-listinglens/77a52ec3-36ea-4781-bab1-ef9ec234d177/scratchpad/meta/`.

## How the look is applied

The editor preview (`src/lib/adjust.ts` `videoStyle`, filters rendered in `src/components/run-preview.tsx`) applies, in this order:
1. an SVG exposure table, `1 - (1 - x)^exposurePower` (257 points, `colorInterpolationFilters="sRGB"`);
2. a contrast table (65 points);
3. CSS `saturate(1 + s / 50)`;
4. a temperature matrix.

The browser export (`src/lib/browser-export.ts` fragment shader `FS`) applies the same curves per channel in the same order, with `exposurePower` and `contrastGamma` from `render/render.mjs`. It uses CSS saturate's luma weights (0.213, 0.715, 0.072). The server export uses `look()` in `render/render.mjs`.

## What Claude measured

Script: `/tmp/claude-1000/-home-farhan-listinglens/77a52ec3-36ea-4781-bab1-ef9ec234d177/scratchpad/look.mjs`. Frame mapping: `map.mjs`, using `frameSchedule`, which gives the exact source frame for each export frame.

- For three frames per clip (clips without zoom), Claude took the exact source frame, centre-cropped it to 9:16 at 1080x1920 in RGB, and applied the intended look in JS with the same formulas.
- It then compared that against the export frame, converted to RGB by ffmpeg honouring the range tags.

Results:
- **Production file:** PSNR 14 to 24 dB, because the captions are burned in and the reference has none.
- **Caption-free `clean.mp4`:**
  - mean luma (exposure) within 0.2;
  - luma standard deviation (contrast) within 0.4;
  - mean HSV saturation within 0.2;
  - PSNR 41 to 45 dB in every measured frame, including clip 6 (brightness 5, contrast 23) and clip 3 (contrast 3, saturation 4).
  - The unadjusted clips 4, 5 and 7 match their sources at 43 to 44 dB.

## Check brutally

1. Reproduce Claude's numbers. Check that the reference math matches the preview's actual rendering, not just the formulas:
   - render the editor preview in Chrome: a `<video>` or the source frame with the same SVG filters and CSS that `run-preview.tsx` and `videoStyle` produce, for clip 3, clip 6 and the hook;
   - screenshot it (CDP), and compare its colours with the export frame;
   - mind the table interpolation, Chrome's video colour management (BT.709 video drawn on screen against WebGL texture upload), and premultiplied alpha.
2. Cover the zoomed clips 1 and 2: zoom at the slot time, so the look and the geometry match the preview.
3. Is the full-range export (`yuvj420p`, pc) read correctly by phones, QuickTime and TikTok/Instagram uploads? Any risk of the colours shifting there? This is a known open question; the founder declined a risky change.
4. The server lane (`render/render.mjs` `look()`, lutrgb/eq filters): does it match the browser lane and the preview for the same looks? Run it on these sources.
5. The production file against `clean.mp4` outside the caption areas: they should be the same encode apart from the text.
6. Anything that makes the export's colours differ visibly from what the founder saw in the editor.

Report in plain English: a verdict, a table of measured differences per clip (exposure, contrast, saturation, PSNR), and any fix needed.
