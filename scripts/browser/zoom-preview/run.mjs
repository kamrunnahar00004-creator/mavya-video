// Captures the zoom lab (lab.html) frame by frame in Windows Chrome: shots-<dpr>-<variant>/NNN.png. Run by zoom-preview.sh.
// Its own Chrome on a debugging port nobody else holds, a fresh profile, a 4-minute watchdog, and cleanup on every exit
// (Codex 2026-11-11). Hidden-window throttling is off, or a covered window never paints (rAF stops).
import { spawn } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import url from "node:url";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = path.dirname(url.fileURLToPath(import.meta.url));
const [dpr = 1, variants = "app,exact"] = [Number(process.argv[2] || 1), process.argv[3]];
const PORT = 9344, PROFILE = `${process.env.TEMP}\\mavya-zl-${Date.now()}`;
const up = async () => { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); return true; } catch { return false; } };
if (await up()) { console.error(`zoom-preview: port ${PORT} is already in use; close that Chrome first`); process.exit(1); }
let chrome = null, ws = null;
async function cleanup() {
  try { ws?.close(); } catch {}
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise((r) => { chrome.once("exit", r); setTimeout(r, 5000); }); }
  for (let i = 0; i < 10; i++) { try { fs.rmSync(PROFILE, { recursive: true, force: true }); break; } catch { await sleep(500); } }
}
const watchdog = setTimeout(async () => { console.error("zoom-preview: no result within 4 min"); await cleanup(); process.exit(1); }, 240_000);
let code = 0;
try {
  chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--allow-file-access-from-files", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=500,700", "about:blank"], { stdio: "ignore" });
  const launch = new Promise((_, j) => chrome.once("error", (e) => j(new Error(`Chrome did not start: ${e.message}`))));
  void launch.catch(() => undefined);
  let tabs = [];
  for (let i = 0; i < 100 && chrome.exitCode === null; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (tabs.some((t) => t.type === "page")) break; } catch {} await sleep(200); }
  const page = tabs.find((t) => t.type === "page" && t.url === "about:blank");
  if (!page) await Promise.race([launch, Promise.reject(new Error("our Chrome never opened its blank page"))]);
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const wait = {};
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => { const m = await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true }); if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300)); return m.result?.result?.value; };
  await send("Emulation.setDeviceMetricsOverride", { width: 400, height: 600, deviceScaleFactor: dpr, mobile: false });
  await send("Page.navigate", { url: url.pathToFileURL(path.join(dir, "lab.html")).href }); await sleep(1500); await ev("window.ready");
  for (const variant of variants.split(",")) {
    const odir = path.join(dir, `shots-${dpr}-${variant}`); fs.mkdirSync(odir, { recursive: true });
    for (let n = 0; n < 90; n++) {
      await ev(`setT(${n / 30},${JSON.stringify(variant)}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      const s = await send("Page.captureScreenshot", { format: "png", clip: { x: 40, y: 40, width: 258, height: 459, scale: 1 } });
      if (!s.result?.data) throw new Error("screenshot failed");
      fs.writeFileSync(path.join(odir, String(n).padStart(3, "0") + ".png"), Buffer.from(s.result.data, "base64"));
    }
  }
} catch (e) { console.error("zoom-preview:", e.message); code = 1; }
finally { clearTimeout(watchdog); await cleanup(); }
process.exit(code);
