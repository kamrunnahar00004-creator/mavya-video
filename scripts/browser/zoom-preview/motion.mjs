// Per frame pair: zoom step (per mille) and shift (px) fitted from 16 tracked patches. Used by zoom-preview.sh.
// Per frame pair: scale and shift (x, y) fitted from 16 tracked patches (SAD search with subpixel fit).
import { spawn } from "node:child_process";
const [ff, file, W = 360, H = 640] = process.argv.slice(2).map((v, i) => (i >= 2 ? Number(v) : v));
const p = spawn(ff, ["-v", "error", "-i", file, "-vf", `scale=${W}:${H}:flags=area,format=gray`, "-f", "rawvideo", "-"]);
const size = W * H; let buf = Buffer.alloc(0); const frames = [];
p.stdout.on("data", (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= size) { frames.push(Uint8Array.from(buf.subarray(0, size))); buf = buf.subarray(size); } });
await new Promise((r) => p.on("close", r));
const B = 20, R = 8, cx = W / 2, cy = H / 2;
const pts = []; for (const fx of [0.2, 0.4, 0.6, 0.8]) for (const fy of [0.2, 0.4, 0.6, 0.8]) pts.push([Math.round(W * fx), Math.round(H * fy)]);
function sad(a, b, x, y, dx, dy) { let s = 0; for (let j = -B / 2; j < B / 2; j++) { const ra = (y + j) * W, rb = (y + j + dy) * W; for (let i = -B / 2; i < B / 2; i++) s += Math.abs(a[ra + x + i] - b[rb + x + i + dx]); } return s; }
function track(a, b, x, y) {
  let best = [Infinity, 0, 0]; const tbl = {};
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const s = sad(a, b, x, y, dx, dy); tbl[dx + "," + dy] = s; if (s < best[0]) best = [s, dx, dy]; }
  const [s0, dx, dy] = best; if (Math.abs(dx) === R || Math.abs(dy) === R) return null;
  const sub = (m, z, p) => { const d = m - 2 * z + p; return d > 0 ? (m - p) / (2 * d) : 0; };
  // texture check: reject flat patches
  let mean = 0, v = 0; for (let j = -B / 2; j < B / 2; j++) for (let i = -B / 2; i < B / 2; i++) mean += a[(y + j) * W + x + i]; mean /= B * B;
  for (let j = -B / 2; j < B / 2; j++) for (let i = -B / 2; i < B / 2; i++) v += (a[(y + j) * W + x + i] - mean) ** 2; if (v / (B * B) < 60) return null;
  return [dx + sub(tbl[(dx - 1) + "," + dy], s0, tbl[(dx + 1) + "," + dy]), dy + sub(tbl[dx + "," + (dy - 1)], s0, tbl[dx + "," + (dy + 1)])];
}
const out = [];
for (let n = 1; n < frames.length; n++) {
  const rows = []; for (const [x, y] of pts) { const d = track(frames[n - 1], frames[n], x, y); if (d) rows.push([x - cx, y - cy, d[0], d[1]]); }
  if (rows.length < 6) { out.push(null); continue; }
  // d = t + k * (p - c): least squares for k (shared), tx, ty
  const N = rows.length; let sx = 0, sy = 0, sdx = 0, sdy = 0; for (const [x, y, dx, dy] of rows) { sx += x; sy += y; sdx += dx; sdy += dy; }
  const mx = sx / N, my = sy / N, mdx = sdx / N, mdy = sdy / N; let num = 0, den = 0;
  for (const [x, y, dx, dy] of rows) { num += (x - mx) * (dx - mdx) + (y - my) * (dy - mdy); den += (x - mx) ** 2 + (y - my) ** 2; }
  const k = num / den, tx = mdx - k * mx, ty = mdy - k * my;
  let res = 0; for (const [x, y, dx, dy] of rows) res += (dx - tx - k * x) ** 2 + (dy - ty - k * y) ** 2;
  out.push({ n, k: +(k * 1000).toFixed(2), tx: +tx.toFixed(2), ty: +ty.toFixed(2), res: +Math.sqrt(res / N).toFixed(2), N });
}
console.log(JSON.stringify(out));
