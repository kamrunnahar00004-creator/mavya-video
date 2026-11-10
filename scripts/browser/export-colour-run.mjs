// Drives Windows Chrome (headed: the real GPU encoder) on the export lab page; saves one export per encoder setting
// this Chrome supports as out-<label>.mp4 next to this script. Run by scripts/browser/export-colour.sh.
import { spawn } from "node:child_process";
import fs from "node:fs";
const CHROME = process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = `${process.env.TEMP}/mavya-export-colour-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--remote-debugging-port=9338", `--user-data-dir=${PROFILE}`, "--no-first-run", "--window-size=500,400", "--window-position=0,0", "about:blank"], { stdio: "ignore" });
const watchdog = setTimeout(() => { console.error("export colour: no result within 6 min"); chrome.kill(); process.exit(1); }, 6 * 60_000);
let tabs;
for (let i = 0; i < 100; i++) { try { tabs = await (await fetch("http://127.0.0.1:9338/json")).json(); if (tabs.some((t) => t.type === "page")) break; } catch {} await sleep(200); }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let n = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++n; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const m = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400)); return m.result?.result?.value; };
try {
  await send("Page.navigate", { url: `http://localhost:3210/export-lab?t=${process.env.T ?? 2}` });
  for (let i = 0; i < 300 && !(await ev("typeof window.__lab === 'function'").catch(() => false)); i++) await sleep(200);
  // Whether this Chrome has a hardware H.264 encoder at the export size (no GPU: every "hw" setting is software).
  const hw = await ev(`VideoEncoder.isConfigSupported({ codec: "avc1.640033", width: 1080, height: 1920, hardwareAcceleration: "prefer-hardware" }).then(r => r.supported, () => false)`);
  console.log("hardware encoder:", hw ? "yes" : "NO (software only: the GPU path is not exercised)");
  const labels = (await ev("window.__labels")).filter((l) => !process.env.ONLY || l === process.env.ONLY);
  let made = 0;
  for (const label of labels) {
    const t0 = Date.now();
    const r = await ev(`window.__lab(${JSON.stringify(label)}).catch(e => ({ error: String(e) }))`);
    const took = Date.now() - t0;
    if (r?.error) { console.log(`${label}: not available here (${r.error.slice(0, 80)})`); continue; }
    fs.writeFileSync(`out-${label}.mp4`, Buffer.from(r.b64, "base64"));
    console.log(`${label}: exported in ${took} ms (${r.encoder})`);
    made++;
  }
  if (!made) { console.error("export colour: no encoder setting worked"); process.exitCode = 1; }
} finally { clearTimeout(watchdog); chrome.kill(); await sleep(500); fs.rmSync(PROFILE, { recursive: true, force: true }); }
