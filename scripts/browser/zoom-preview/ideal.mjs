// The perfect reference: an exact float zoom of the unzoomed frame. Used by zoom-preview.sh.
import { spawn, execFileSync } from "node:child_process";
const [ff, png, out, W, H] = process.argv.slice(2).map((v, i) => (i >= 3 ? Number(v) : v));
const src = execFileSync(ff, ["-v", "error", "-i", png, "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 26 });
const enc = spawn(ff, ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${W}x${H}`, "-r", "30", "-i", "-", "-c:v", "libx264", "-crf", "0", out], { stdio: ["pipe", "inherit", "inherit"] });
const z = (t) => { const p = Math.min(1, Math.max(0, (t - 0.3) / 2)); return 1 + 0.32 * p * p * (3 - 2 * p); };
for (let n = 0; n < 90; n++) { const s = 1 / z(n / 30), ox = (1 - s) / 2 * W, oy = (1 - s) / 2 * H, f = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) { const sy = Math.max(0, Math.min(H - 1.001, oy + (y + 0.5) * s - 0.5)), y0 = Math.floor(sy), fy = sy - y0; for (let x = 0; x < W; x++) { const sx = Math.max(0, Math.min(W - 1.001, ox + (x + 0.5) * s - 0.5)), x0 = Math.floor(sx), fx = sx - x0, i = y0 * W + x0;
    f[y * W + x] = (src[i] * (1 - fx) + src[i + 1] * fx) * (1 - fy) + (src[i + W] * (1 - fx) + src[i + W + 1] * fx) * fy; } }
  if (!enc.stdin.write(f)) await new Promise((r) => enc.stdin.once("drain", r)); }
enc.stdin.end(); await new Promise((r) => enc.on("close", r));
