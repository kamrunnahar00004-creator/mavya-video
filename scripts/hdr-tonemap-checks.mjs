// iPhone HDR (HLG) uploads must look in the copies as they do in Chrome (founder 2026-11-11: after a refresh the editor
// played the copy and the colours "bursted"). Three lossless HLG patches at the BT.2408 levels (18% grey 0.38, paper
// white 0.75, highlight 0.90) go through the server's own TONEMAP; Chrome shows them as Y 78 / 177 / 215 (measured
// 2026-11-11, Windows Chrome, RGB 72 / 187 / 232). The old mobius npl=100 gave 141 / 218 / 231. Offline, ~2 s.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import url from "node:url";
const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const { TONEMAP } = await import(path.join(root, "render/render.mjs"));
const ff = path.join(root, "node_modules/ffmpeg-static/ffmpeg");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-tonemap-"));
let checks = 0; const ok = (c, m) => { checks++; if (!c) { console.error("hdr-tonemap-checks FAILED:", m); process.exitCode = 1; } };
try {
  for (const [code, chrome, name] of [[397, 77.8, "18% grey"], [721, 176.6, "paper white"], [852, 215.3, "highlight"]]) {
    const clip = `${dir}/p${code}.mp4`;
    execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=black:s=480x854:r=30:d=0.1,format=yuv444p10le,geq=lum=${code}:cb=512:cr=512,format=yuv420p10le`,
      "-c:v", "libx265", "-x265-params", "log-level=error:lossless=1", "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc", "-color_range", "tv", clip]);
    const out = spawnSync(ff, ["-hide_banner", "-i", clip, "-frames:v", "1", "-vf", `${TONEMAP},signalstats,metadata=print:key=lavfi.signalstats.YAVG`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const y = Number(/YAVG=([\d.]+)/.exec(out)?.[1] ?? NaN);
    ok(Math.abs(y - chrome) <= 13, `${name}: Y ${y} where Chrome shows ${chrome} (allowed 13; old mobius npl=100 was off by up to 63)`);
  }
} catch (e) { ok(false, String(e).slice(0, 300)); }
finally { fs.rmSync(dir, { recursive: true, force: true }); }
if (!process.exitCode) console.log(`hdr-tonemap-checks: ${checks} checks passed`);
