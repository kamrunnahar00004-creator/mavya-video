// Zoom 0 -> 32 % from 0.3 to 2.3 s: per-frame zoom-step error and shift against the planned curve. Exits 1 past limits.
const m = JSON.parse(require("fs").readFileSync(process.argv[2])); const [maxShift, maxStep] = [Number(process.argv[3]), Number(process.argv[4])];
const z = (t) => { const p = Math.min(1, Math.max(0, (t - 0.3) / 2)); return 1 + 0.32 * p * p * (3 - 2 * p); };
let se = 0, st = 0, c = 0, lost = 0;
for (let i = 0; i < m.length; i++) { const r = m[i], t = (i + 1) / 30; if (t < 0.2 || t > 2.5) continue; if (!r) { lost++; continue; } const want = (z(t) / z(t - 1 / 30) - 1) * 1000; se += (r.k - want) ** 2; st += r.tx ** 2 + r.ty ** 2; c++; }
const shift = Math.sqrt(st / c), step = Math.sqrt(se / c);
console.log(`${process.argv[5] ?? ""}: ${c} frames measured, ${lost} lost; shift ${shift.toFixed(2)} px per frame, zoom-step error ${step.toFixed(2)} (limits ${maxShift}, ${maxStep})`);
// Every frame pair in the window must be measured: a jump that defeats tracking must fail, not vanish (Codex).
if (lost || c !== 70 || !(shift <= maxShift) || !(step <= maxStep)) process.exit(1);
