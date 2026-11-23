// Runs lab.html (src/lib/browser-copies.ts on each clip) in Windows Chrome. Run by copies.sh with Windows node.
// Serves the lab folder over http (same origin for the page, the clips and the module) and takes the copies back by
// PUT /out/<name>. Its own Chrome on a free port, a fresh profile, a 10-minute watchdog, cleanup on every exit.
import { spawn } from "node:child_process"; import fs from "node:fs"; import http from "node:http"; import path from "node:path"; import url from "node:url";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = path.dirname(url.fileURLToPath(import.meta.url));
const PORT = 9353, WEB = 9354, PROFILE = `${process.env.TEMP}\\mavya-copies-${Date.now()}`;
const types = { ".html": "text/html", ".js": "text/javascript", ".mov": "video/quicktime", ".mp4": "video/mp4", ".json": "application/json" };
fs.mkdirSync(path.join(dir, "out"), { recursive: true });
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  if (req.method === "PUT" && name.startsWith("out/")) { req.pipe(fs.createWriteStream(path.join(dir, name))).on("finish", () => res.end("ok")); return; }
  const file = path.join(dir, name);
  if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(WEB, "127.0.0.1");
let chrome = null, ws = null;
async function cleanup() {
  try { ws?.close(); } catch {}
  server.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise((r) => { chrome.once("exit", r); setTimeout(r, 5000); }); }
  for (let i = 0; i < 10; i++) { try { fs.rmSync(PROFILE, { recursive: true, force: true }); break; } catch { await sleep(500); } }
}
const watchdog = setTimeout(async () => { console.error("copies: no result within 10 min"); await cleanup(); process.exit(1); }, 600_000);
let code = 0;
try {
  chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--window-size=700,500", "about:blank"], { stdio: "ignore" });
  let tabs = [];
  for (let i = 0; i < 100 && chrome.exitCode === null; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (tabs.some((t) => t.type === "page")) break; } catch {} await sleep(200); }
  const page = tabs.find((t) => t.type === "page" && t.url === "about:blank");
  if (!page) throw new Error("our Chrome never opened its blank page");
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const wait = {};
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.navigate", { url: `http://127.0.0.1:${WEB}/lab.html` });
  let loaded = false;
  for (let i = 0; i < 150 && !loaded; i++) { const m = await send("Runtime.evaluate", { expression: "window.done instanceof Promise", returnByValue: true }); loaded = m.result?.result?.value === true; if (!loaded) await sleep(200); }
  if (!loaded) throw new Error("lab.html never loaded");
  const r = await send("Runtime.evaluate", { expression: "window.done.then((x) => JSON.stringify(x))", awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  fs.writeFileSync(path.join(dir, "out", "result.json"), r.result.result.value);
} catch (e) { console.error("copies:", e.message); code = 1; }
finally { clearTimeout(watchdog); await cleanup(); }
process.exit(code);
