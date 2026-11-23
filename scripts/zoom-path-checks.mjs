// Keyframed zoom moves like CapCut (founder 2026-11-23: "it first goes to the center and then goes left"). Zoom and
// pan were blended apart, and pan is a share of the room the zoom leaves, so a zoom in from 0 toward the left hugged
// the center, then rushed left at the end. Now zoom and the place on screen (pan x zoom) blend together.
// Checks the preview (src/lib/adjust.ts) and that the server export (render/render.mjs) cuts exactly the same window
// every frame, evaluating its ffmpeg expressions; and the browser export's formula. Offline, no ffmpeg run.
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import url from "node:url"; import { createRequire } from "node:module";
const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const require = createRequire(import.meta.url);
const { load } = require("./check-module.cjs");
const a = load("src/lib/adjust.ts", { react: {} });
const { plan, stepArgs } = await import(path.join(root, "render/render.mjs"));

let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const near = (x, y, tol, m) => ok(Math.abs(x - y) <= tol, `${m} (${x} vs ${y})`);
// Where the view's left edge sits, as a share of the frame width (what every renderer computes).
const leftOf = (m) => { const z = 1 + m.zoom / 100; return ((1 - 1 / z) / 2) * (1 - m.panX / 100); };

// The founder's case: from no zoom to zoomed in on the left.
const toLeft = { keys: [{ t: 0, zoom: 0, panX: 0, panY: 0 }, { t: 2, zoom: 60, panX: -100, panY: 0 }] };
const path1 = [0.2, 0.5, 1, 1.5, 1.9].map((t) => a.motionAt(toLeft, t, true));
ok(path1.every((m) => Math.abs(m.panX + 100) < 1e-9), "zooming in from 0, it heads straight for the left the whole way (pan stays -100)");
const shift = (m) => (m.panX / 100) * (m.zoom / 100); // the picture's offset on screen, x frame width / 2
ok(path1.every((m, i) => i === 0 || shift(m) < shift(path1[i - 1])), "and it moves left steadily, never back toward the center");
const mid = a.motionAt(toLeft, 1, true);
near(shift(mid), shift(toLeft.keys[1]) / 2, 1e-9, "halfway in time (ease 0.5), halfway on screen");

// Two zoomed keyframes, the second further left and closer: the place on screen goes straight from one to the other.
const both = { keys: [{ t: 0, zoom: 20, panX: 50, panY: -30 }, { t: 1, zoom: 80, panX: -60, panY: 40 }] };
for (const t of [0.25, 0.5, 0.75]) {
  const p = (t - 0) / 1, e = p * p * (3 - 2 * p), m = a.motionAt(both, t, true);
  near(m.zoom, 20 + 60 * e, 1e-9, `zoom eases as before at ${t}`);
  near(m.panX * m.zoom, 50 * 20 + (-60 * 80 - 50 * 20) * e, 1e-6, `place on screen (x) is a straight blend at ${t}`);
  near(m.panY * m.zoom, -30 * 20 + (40 * 80 + 30 * 20) * e, 1e-6, `place on screen (y) is a straight blend at ${t}`);
  ok(Math.abs(m.panX) <= 100 && Math.abs(m.panY) <= 100, `never past the edge (no black border) at ${t}`);
}
ok(JSON.stringify(a.motionAt(both, 0)) === JSON.stringify({ zoom: 20, panX: 50, panY: -30 }) && JSON.stringify(a.motionAt(both, 1)) === JSON.stringify({ zoom: 80, panX: -60, panY: 40 }), "on a keyframe it is exactly that keyframe");
const still = { keys: [{ t: 0, zoom: 0, panX: 30, panY: 0 }, { t: 1, zoom: 0, panX: -30, panY: 0 }] };
ok(Number.isFinite(a.motionAt(still, 0.5, true).panX), "no zoom on either side: no division by zero");

// Editing keys (Codex 2026-11-23): a key changes only what is edited, from its own values; a new key does not move the picture.
const two = { keys: [{ t: 0, zoom: 0, panX: 0, panY: 0 }, { t: 1, zoom: 100, panX: 100, panY: 0 }] };
const edited = a.setMotion(two, 0.05, { zoom: 50 }).keys[0];
ok(edited.t === 0 && edited.zoom === 50 && edited.panX === 0, `zooming the first key near the playhead keeps its own pan (${JSON.stringify(edited)})`);
const before = a.motionAt(two, 0.52, true), added = a.toggleKey(two, 0.52), after = a.motionAt(added, 0.52, true);
ok(added.keys.length === 3 && Math.abs(after.zoom - before.zoom) < 1e-9 && Math.abs(after.panX - before.panX) < 1e-9, "adding a key leaves the picture exactly where it was");

// The server export cuts the same window, frame by frame. Its perspective corners are ffmpeg expressions; evaluate x0.
const W = 1080, H = 1920, fps = 30;
const spec = { width: W, height: H, fps, total: 2, segments: [{ url: "x", gap: 0, speed: 1, volume: 0, look: both, pieces: [{ start: 0, end: 2 }] }], sounds: [], overlays: [] };
const step = plan(spec)[0];
const args = stepArgs(spec, step, { file: "in.mp4", hasAudio: false, duration: 2, width: W, height: H, hdr: false }, "out.mkv", 60, undefined);
const graph = args.find((x) => String(x).includes("perspective="));
ok(Boolean(graph), "the server export draws keyframes with perspective");
const x0 = /perspective=x0='([^']+)'/.exec(graph)[1];
const evalAt = (expr, n) => Function("W", "H", "n", `const IF=(c,x,y)=>c?x:y, LT=(x,y)=>x<y; return ${expr.replace(/\bif\(/g, "IF(").replace(/\blt\(/g, "LT(").replace(/\bin\b/g, "n")};`)(W, H, n);
let worst = 0;
for (let n = 1; n <= 30; n++) {
  const t = (n - 1) / fps;
  worst = Math.max(worst, Math.abs(evalAt(x0, n) - leftOf(a.motionAt(both, t, true)) * W));
}
ok(worst < 0.01, `server export and preview cut the same window every frame (worst ${worst.toFixed(4)} px)`);

// Keys sharing a time: everywhere the later one from that time on (Codex 2026-11-23), and dragging a key onto another's time is refused.
const dup = { keys: [{ t: 0, zoom: 0, panX: 0, panY: 0 }, { t: 0, zoom: 60, panX: 50, panY: 0 }, { t: 1, zoom: 80, panX: 50, panY: 0 }] };
ok(a.motionAt(dup, 0, true).zoom === 60, "two keys at one time: the preview shows the later one, like the exports");
const dspec = { ...spec, segments: [{ ...spec.segments[0], look: dup }] };
const dgraph = stepArgs(dspec, plan(dspec)[0], { file: "in.mp4", hasAudio: false, duration: 2, width: W, height: H, hdr: false }, "out.mkv", 60, undefined).find((x) => String(x).includes("perspective="));
near(evalAt(/perspective=x0='([^']+)'/.exec(dgraph)[1], 1), leftOf(a.motionAt(dup, 0, true)) * W, 0.01, "and the server export cuts the same window on that frame");
const moved = a.moveKey(two, 1, 0);
ok(moved.keys.length === 2 && moved.keys.map((k) => k.t).join() === "0,1", "a key dragged onto another key's time stays where it was");
ok(a.moveKey(two, 1, 0.5).keys[1].t === 0.5, "a normal drag still moves it");

// The server export keeps keyframe times to the microsecond (a piece 0.4 ms in picked the wrong side of a 10 ms key).
const fine = { keys: [{ t: 0, zoom: 0, panX: 0, panY: 0 }, { t: 0.01, zoom: 100, panX: 0, panY: 0 }] };
const fspec = { width: W, height: H, fps, total: 1, segments: [{ url: "x", gap: 0, speed: 1, volume: 0, look: fine, pieces: [{ start: 0.0004, end: 1 }] }], sounds: [], overlays: [] };
const fgraph = stepArgs(fspec, plan(fspec)[0], { file: "in.mp4", hasAudio: false, duration: 2, width: W, height: H, hdr: false }, "out.mkv", 30, undefined).find((x) => String(x).includes("perspective="));
ok(/\+0\.0004\)/.test(fgraph), "the piece start goes into the keyframe clock unrounded (0.0004)");

// The preview's anti-snap tilt never bares an edge, even pushed fully to a side at any zoom.
let bare = 0;
for (const zoom of [5, 20, 50, 100]) for (const panX of [-100, 100]) for (const panY of [-100, 100]) {
  const st = a.videoStyle({ zoom, panX, panY }).transform;
  const S = Number(/scale\(([\d.]+)\)/.exec(st)[1]), [tx, ty] = /translate\(([-\d.e]+)%, ([-\d.e]+)%\)/.exec(st).slice(1).map(Number), th = 0.02 * Math.PI / 180;
  const w = 720, h = 1280;
  for (const [cx, cy] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]]) {
    const ux = cx / S - (tx / 100) * w, uy = cy / S - (ty / 100) * h; // undo scale, then translate
    const x = ux * Math.cos(th) + uy * Math.sin(th), y = -ux * Math.sin(th) + uy * Math.cos(th); // undo rotate
    if (Math.abs(x) > w / 2 + 1e-6 || Math.abs(y) > h / 2 + 1e-6) bare++;
  }
}
ok(bare === 0, `no corner of the frame outside the picture (${bare} bared)`);

// The browser export uses the same formula.
const be = fs.readFileSync("src/lib/browser-export.ts", "utf8");
ok(be.includes('gl.uniform3f(u("zoom"), (z - 1 - dx) / (2 * z), (z - 1 - dy) / (2 * z), 1 / z);') && be.includes("dx: (k.panX * k.zoom) / 1e4"), "the browser export blends the place on screen the same way");

if (checks !== 28) { console.error(`zoom-path-checks: ${checks} checks ran, expected 28`); process.exit(1); }
console.log(`zoom-path-checks: ${checks} checks pass`);
