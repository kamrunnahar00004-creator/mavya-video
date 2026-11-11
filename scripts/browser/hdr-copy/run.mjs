// Shows lab.html (the HDR original next to its copies) in Windows Chrome and saves shot.png. Run by hdr-copy.sh.
// Its own Chrome on a port nobody else holds, a fresh profile, a 2-minute watchdog, and cleanup on every exit.
import { spawn } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import url from "node:url";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = path.dirname(url.fileURLToPath(import.meta.url));
const PORT = 9352, PROFILE = `${process.env.TEMP}\\mavya-hdr-${Date.now()}`;
const up = async () => { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); return true; } catch { return false; } };
if (await up()) { console.error(`hdr-copy: port ${PORT} is already in use; close that Chrome first`); process.exit(1); }
let chrome = null, ws = null;
async function cleanup() {
  try { ws?.close(); } catch {}
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise((r) => { chrome.once("exit", r); setTimeout(r, 5000); }); }
  for (let i = 0; i < 10; i++) { try { fs.rmSync(PROFILE, { recursive: true, force: true }); break; } catch { await sleep(500); } }
}
const watchdog = setTimeout(async () => { console.error("hdr-copy: no result within 2 min"); await cleanup(); process.exit(1); }, 120_000);
let code = 0;
try {
  chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--allow-file-access-from-files", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--window-size=700,500", "about:blank"], { stdio: "ignore" });
  chrome.once("error", (e) => { console.error(`hdr-copy: Chrome did not start: ${e.message}`); });
  let tabs = [];
  for (let i = 0; i < 100 && chrome.exitCode === null; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (tabs.some((t) => t.type === "page")) break; } catch {} await sleep(200); }
  const page = tabs.find((t) => t.type === "page" && t.url === "about:blank");
  if (!page) throw new Error("our Chrome never opened its blank page");
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const wait = {};
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Emulation.setDeviceMetricsOverride", { width: 600, height: 340, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: url.pathToFileURL(path.join(dir, "lab.html")).href });
  // Waits for this page's own promise (not a fixed sleep): every video loaded and on its frame (Codex 2026-11-11).
  let loaded = false;
  for (let i = 0; i < 150 && !loaded; i++) { const m = await send("Runtime.evaluate", { expression: "location.href.endsWith('lab.html') && window.ready instanceof Promise", returnByValue: true }); loaded = m.result?.result?.value === true; if (!loaded) await sleep(200); }
  if (!loaded) throw new Error("lab.html never loaded");
  const ready = await send("Runtime.evaluate", { expression: "window.ready.then(() => true)", awaitPromise: true, returnByValue: true });
  if (ready.result?.exceptionDetails || ready.result?.result?.value !== true) throw new Error("a video did not load");
  await sleep(500);
  const s = await send("Page.captureScreenshot", { format: "png" });
  if (!s.result?.data) throw new Error("screenshot failed");
  fs.writeFileSync(path.join(dir, "shot.png"), Buffer.from(s.result.data, "base64"));
} catch (e) { console.error("hdr-copy:", e.message); code = 1; }
finally { clearTimeout(watchdog); await cleanup(); }
process.exit(code);
