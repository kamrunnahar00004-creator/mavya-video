// An iPhone-like HDR clip for the HDR checks: 10-bit HEVC in a .mov (hvc1), tagged BT.2020 / HLG like an iPhone's,
// with four flat bands at known HLG signal levels. Lossless, so every check measures exactly these values. Every ffmpeg
// run has a timeout: a synchronous run that hangs would block the caller's watchdog (Codex 2026-11-11).
import { execFileSync } from "node:child_process";

/**
 * The bands, top to bottom: 10-bit limited-range codes (Y = 64 + 876 E, C = 512 + 896 E). Grey, white and highlight are
 * the BT.2408 reference levels (HLG 0.38 = 18% grey, 0.75 = paper white, 0.90 = highlight); skin is HLG RGB
 * (0.62, 0.50, 0.42). `chrome` is what Windows Chrome shows for this clip (sRGB, measured 2026-11-11 with
 * scripts/browser/hdr-copy.sh): the colours the editor shows before its copy exists, so the copy must match them.
 */
export const BANDS = [
  { name: "18% grey", y: 397, cb: 512, cr: 512, chrome: [72, 72, 72] },
  { name: "paper white", y: 721, cb: 512, cr: 512, chrome: [187, 187, 187] },
  { name: "highlight", y: 852, cb: 512, cr: 512, chrome: [232, 233, 232] },
  { name: "skin", y: 525, cb: 461, cr: 569, chrome: [140, 97, 82] },
];

/** Writes the clip (w x h, `seconds` long, silent) to `out`. */
export function makeHlgClip(ff, out, w = 720, h = 1280, seconds = 1) {
  const band = (i) => `between(Y,${Math.round((i * h) / BANDS.length)},${Math.round(((i + 1) * h) / BANDS.length) - 1})`;
  const pick = (k) => BANDS.reduceRight((rest, b, i) => `if(${band(i)},${b[k]},${rest})`, "512");
  execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=black:s=${w}x${h}:r=30:d=${seconds},format=yuv444p10le`,
    "-vf", `geq=lum='${pick("y")}':cb='${pick("cb")}':cr='${pick("cr")}',format=yuv420p10le`,
    "-c:v", "libx265", "-tag:v", "hvc1", "-x265-params", "log-level=error:lossless=1",
    "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc", "-color_range", "tv", "-f", "mov", out], { timeout: 60_000 });
}

/** Mean sRGB of the middle of each band in a picture or video frame `file` (at `at` seconds), as [[r, g, b], ...]. */
export function bandColours(ff, file, at = 0.5) {
  const raw = execFileSync(ff, ["-v", "error", ...(file.endsWith(".jpg") || file.endsWith(".png") ? [] : ["-ss", String(at)]), "-i", file, "-frames:v", "1",
    "-vf", "scale=64:64:flags=area,format=rgb24", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20, timeout: 30_000 });
  return BANDS.map((_, i) => {
    const sum = [0, 0, 0]; let n = 0;
    const y0 = Math.floor((i * 64) / BANDS.length) + 3, y1 = Math.floor(((i + 1) * 64) / BANDS.length) - 3;
    for (let y = y0; y < y1; y++) for (let x = 8; x < 56; x++) { for (let c = 0; c < 3; c++) sum[c] += raw[(y * 64 + x) * 3 + c]; n++; }
    return sum.map((s) => Math.round(s / n));
  });
}
