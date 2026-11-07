// Browser integration checks for the editor and New video (founder rule 2026-11-07: every raised problem gets a test).
// Real Chrome (CDP), real mouse and keys, against a credential-free local copy of the app: run scripts/browser/run.sh,
// which builds the copy, seeds media, starts the server and runs this with Windows node + Chrome (WSL setup), or set
// MAVYA_URL / CHROME to your own. Covers the paths unit checks cannot: what the components actually call.
import { spawn } from "node:child_process";

const B = process.env.MAVYA_URL ?? "http://localhost:3210";
const CHROME = process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = process.env.CHROME_PROFILE ?? `${process.env.TEMP ?? "/tmp"}/mavya-browser-checks-${Date.now()}`;
const RID = "dddddddd-4444-4444-8444-444444444444";
const U = (n) => `11111111-aaaa-4aaa-8aaa-00000000000${n}.mp4`;
const CTRL = 2, SHIFT = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
let passed = 0;
const check = (cond, msg) => { if (cond) passed++; else { failures.push(msg); console.log("FAIL", msg); } };

const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--remote-debugging-port=9335", `--user-data-dir=${PROFILE}`, "--window-size=1440,1000", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const watchdog = setTimeout(() => { console.error("browser checks: did not finish within 15 min"); chrome.kill(); process.exit(1); }, 15 * 60_000);
let tabs;
for (let i = 0; i < 100; i++) { try { tabs = await (await fetch("http://127.0.0.1:9335/json")).json(); if (tabs.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let n = 0;
const pend = new Map(), handlers = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else handlers.forEach((h) => h(m)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++n; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const m = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.error || m.result?.exceptionDetails) throw Error(`page script failed: ${JSON.stringify(m.error ?? m.result.exceptionDetails).slice(0, 300)}`);
  return m.result?.result?.value;
};
const waitFor = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return Date.now() - t; await sleep(50); } return -1; };
const api = async (id = RID) => (await (await fetch(`${B}/api/runs/${id}?view=editor`, { cache: "no-store" })).json()).run;
// The saved run once `pred` holds; a timeout is a failed check (with the last state), never a silent pass.
const until = async (pred, id = RID, what = "saved state") => { let r; for (let i = 0; i < 80; i++) { r = await api(id).catch(() => null); if (r && pred(r)) return r; await sleep(250); } check(false, `${what} never arrived: ${JSON.stringify(r)?.slice(0, 300)}`); return r ?? { texts: [], demo: { clips: [] }, sounds: [] }; };
const box = (label) => ev(`(()=>{const e=[...document.querySelectorAll('[role=dialog] [role=button][aria-label]')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+Math.min(40,r.width/2),y:r.y+r.height/2}})()`);
const mouse = async (b, mods = 0) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: b.x, y: b.y, button: "left", clickCount: 1, modifiers: mods }); };
// A plain click redraws the side panel; wait for it before the next click (a human never clicks within 150 ms).
const click = async (label, mods = 0) => { const b = await box(label); if (!b) return false; await mouse(b, mods); await sleep(900); return true; };
const key = async (k, code, vk, mods = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await sleep(250); };
const K = { del: ["Delete", "Delete", 46], esc: ["Escape", "Escape", 27], home: ["Home", "Home", 36], end: ["End", "End", 35], right: ["ArrowRight", "ArrowRight", 39], down: ["ArrowDown", "ArrowDown", 40], up: ["ArrowUp", "ArrowUp", 38], a: ["a", "KeyA", 65], c: ["c", "KeyC", 67], v: ["v", "KeyV", 86], x: ["x", "KeyX", 88], z: ["z", "KeyZ", 90], s: ["s", "KeyS", 83], q: ["q", "KeyQ", 81], w: ["w", "KeyW", 87], B: ["B", "KeyB", 66], eq: ["=", "Equal", 187], minus: ["-", "Minus", 189] };
const press = (name, mods = 0) => key(...K[name], mods);
const pressed = () => ev(`[...document.querySelectorAll('[role=dialog] [role=button][aria-pressed=true]')].map(x=>x.getAttribute('aria-label'))`);
const labels = () => ev(`[...document.querySelectorAll('[role=dialog] [role=button][aria-label]')].map(x=>x.getAttribute('aria-label')).filter(x=>/^(Clip|Text):/.test(x))`);
const clipLabels = async () => (await labels()).filter((x) => x.startsWith("Clip:"));
const headPct = () => ev(`(()=>{const e=document.querySelector('[role=dialog] .pointer-events-none.absolute.bottom-0.top-0.z-20');return e?parseFloat(e.style.left):null})()`);
const playhead = async (secs) => { await press("home"); for (let i = 0; i < Math.floor(secs); i++) await press("right", SHIFT); for (let i = 0; i < Math.round((secs % 1) * 30); i++) await press("right"); };

const T = (id, text, a, b) => ({ id, text, start: a, end: b, x: 50, y: 20, size: 4.6, font: "TikTok Sans", color: "#ffffff", style: "outline" });
const C = (id, label, nn, gap) => ({ id, label, mediaId: U(nn), name: label, seconds: 3, start: 0, end: 3, ...(gap ? { gap } : {}) });
const hook = { mode: "upload", text: "Hook line", clip: { mediaId: U(1), name: "red", kind: "video", offset: 0, length: 3 }, start: 0, end: 3, avatarIndex: null, variationIndex: null };
const S = (id, at, end, row) => ({ id, kind: "upload", src: "/api/media/" + U(1), name: id, at, end, start: 0, volume: 100, row });
const three = () => [C("cg", "green", 2), C("cb", "blue", 3), C("co", "orange", 4)];
const texts4 = () => [T("hook", "Hook line", 0, 3), T("ta", "Text A", 3, 6), T("tb", "Text B", 6, 9), T("tc", "Text C", 9, 12)];
const seed = async (clips, texts, sounds = []) => {
  const r = await fetch(`${B}/api/runs/${RID}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ hook, demo: { clip: null, frame: "none", mode: "clips", clips }, texts, sounds }) });
  if (!r.ok) throw Error(`seed ${r.status} ${await r.text()}`);
};
const open = async () => {
  await send("Page.navigate", { url: `${B}/studio/${RID}` });
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Edit video'))`, 120000);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Edit video')).click()`);
  await waitFor(`!!document.querySelector('[role=dialog] [aria-label^="Clip:"]')`, 60000);
  await sleep(1500);
};
const ids = (r) => r.texts.map((t) => t.id);

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");

// 1. Multi-select and Delete / Undo (founder: "why can't you select multiple clips").
await seed(three(), texts4()); await open();
await click("Text: Text A"); await click("Text: Text B", CTRL);
check(JSON.stringify(await pressed()) === JSON.stringify(["Text: Text A", "Text: Text B"]), "Ctrl-click selects two texts");
await press("del"); let r = await until((x) => x.texts.length === 2);
check(JSON.stringify(ids(r)) === JSON.stringify(["hook", "tc"]), `Delete removes both texts (${ids(r)})`);
await press("z", CTRL); r = await until((x) => x.texts.length === 4);
check(r.texts.length === 4, "one Undo restores both");
let cl = await clipLabels();
await click(cl[1]); await click(cl[2], SHIFT); await press("del");
r = await until((x) => x.demo.clips.length === 1);
check(JSON.stringify(r.demo.clips.map((c) => c.id)) === JSON.stringify(["co"]), "Shift-click two clips, Delete removes both");
await press("z", CTRL); await until((x) => x.demo.clips.length === 3);
await press("a", CTRL); check((await pressed()).length === 8, "Ctrl+A selects every clip and text");
await press("esc"); check((await pressed()).length === 0, "Esc clears the selection");

// 2. Keys: frame and cut navigation (with a split point), Q / W, zoom, Ctrl+X / V.
await seed(three(), texts4()); await open();
await press("home"); const p0 = await headPct(); await press("down"); const p3 = await headPct();
const pct = (p3 - p0) / 3; // percent per second
await playhead(4); await press("esc"); await press("s"); await until((x) => (x.demo.clips[0].parts ?? []).length === 2);
await press("home"); await press("down"); await press("down");
check(Math.abs((await headPct()) / pct - 4) < 0.05, "Down stops at a split point (4 s)");
await press("home"); await press("right"); check(Math.abs((await headPct()) / pct - 1 / 30) < 0.005, "Right steps one frame");
await press("home"); await press("right", SHIFT); check(Math.abs((await headPct()) / pct - 1) < 0.01, "Shift+Right steps 1 s");
await click("Text: Text C"); await playhead(10); await press("q"); await press("right", SHIFT); await press("w");
r = await until((x) => { const t = x.texts.find((y) => y.id === "tc"); return t?.start === 10 && t?.end === 11; });
const tc = r.texts.find((t) => t.id === "tc");
check(tc.start === 10 && tc.end === 11, `Q / W trim Text C to 10-11 (${tc.start}-${tc.end})`);
const zoomOut = () => ev(`[...document.querySelectorAll('[role=dialog] button')].find(b=>b.title==='Zoom out').disabled`);
const z0 = await zoomOut(); await press("eq", CTRL); const z1 = await zoomOut(); await press("minus", CTRL);
check(z0 === true && z1 === false && (await zoomOut()) === true, "Ctrl+= / Ctrl+- zoom the timeline");

// 3. A group, then a sound added: Delete must not remove the old group (Codex 2026-11-07).
await seed(three(), texts4()); await open();
await seed(three(), texts4(), [S("old", 0, 12, 0)]); await open();
await click("Text: Text A"); await click("Text: Text B", CTRL);
check(JSON.stringify(await pressed()) === JSON.stringify(["Text: Text A", "Text: Text B"]), "stale group: the group is selected");
// Pick a sound on its own after the group (what adding one ends with), then Delete.
await click("Sound: old");
check(JSON.stringify(await pressed()) === JSON.stringify(["Sound: old"]), "stale group: the sound alone is now selected");
await press("del");
r = await until((x) => (x.sounds ?? []).length === 0, RID, "the sound deleted");
check(JSON.stringify(ids(r)) === JSON.stringify(["hook", "ta", "tb", "tc"]), `a sound picked after a group: Delete removes the sound, not the group (${ids(r)})`);

// 4. Sounds in groups, Ctrl+A with sounds, group copy / cut / paste, Ctrl+Shift+B.
await seed(three(), texts4(), [S("red", 0, 12, 0)]); await open();
await press("a", CTRL); check((await pressed()).includes("Sound: red"), "Ctrl+A includes the sound");
await press("del"); r = await until((x) => x.demo.clips.length === 0 && (x.sounds ?? []).length === 0);
check(r.demo.clips.length === 0 && r.texts.length === 0 && (r.sounds ?? []).length === 0, "Delete removes clips, texts and the sound together");
await press("z", CTRL); r = await until((x) => x.demo.clips.length === 3 && (x.sounds ?? []).length === 1);
check(r.texts.length === 4, "one Undo brings everything back");
await click("Text: Text A"); await click("Sound: red", CTRL);
check(JSON.stringify(await pressed()) === JSON.stringify(["Text: Text A", "Sound: red"]), `Ctrl-click adds a sound to the text's group (${await pressed()})`);
await press("esc"); await click("Text: Text A"); await click("Text: Text B", CTRL); await press("c", CTRL);
await press("esc"); await playhead(1); await press("v", CTRL);
r = await until((x) => x.texts.length === 6);
const pastedAB = r.texts.filter((t) => !["hook", "ta", "tb", "tc"].includes(t.id)).map((t) => t.start);
check(JSON.stringify(pastedAB) === JSON.stringify([1, 4]), `group paste keeps the 3 s spacing (${pastedAB})`);
await seed(three(), texts4(), [S("red", 0, 12, 0)]); await open();
await playhead(4.5); await press("esc"); await press("B", CTRL | SHIFT);
r = await until((x) => (x.sounds ?? []).length === 2);
check((r.demo.clips[0].parts ?? []).length === 2 && r.texts.filter((t) => t.text === "Text A").length === 2 && (r.sounds ?? []).length === 2, "Ctrl+Shift+B splits the clip, the text and the sound");

// 5. Codex group cases: non-adjacent clips, overlapping sound rows, magnet-off gap, sounds moving on insert.
await seed(three(), [T("tc", "Text C", 9, 12)]); await open();
cl = await clipLabels();
await click(cl[1]); await click(cl[3], CTRL); await click("Text: Text C", CTRL); await press("c", CTRL);
await press("esc"); await press("end"); await press("v", CTRL);
r = await until((x) => x.demo.clips.length === 5 && x.texts.length === 2);
check(r.texts.some((t) => t.start === 15 && t.end === 18), `non-adjacent clips: the caption lands on its clip's copy (${r.texts.map((t) => t.start)})`);
await seed(three(), [], [S("s0", 0, 6, 0), S("s1", 2, 6, 1)]); await open();
await playhead(6); await click("Sound: s0"); await click("Sound: s1", CTRL);
check(JSON.stringify(await pressed()) === JSON.stringify(["Sound: s0", "Sound: s1"]), "two sounds selected");
await press("c", CTRL);
// The toolbar Delete button: it must exist, be enabled and delete both sounds (not only the keyboard key).
const del = await ev(`(()=>{const b=document.querySelector('[role=dialog] button[title^="Delete the selection"]');if(!b||b.disabled||!b.offsetParent)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
check(Boolean(del), "the Delete button is there and enabled for a sound-only group");
if (del) await mouse(del);
r = await until((x) => (x.sounds ?? []).length === 0, RID, "both sounds deleted by the Delete button");
check(r.demo.clips.length === 3, "the Delete button removed only the sounds");
await press("z", CTRL);
r = await until((x) => (x.sounds ?? []).length === 2, RID, "Undo restoring both sounds");
await press("esc"); await playhead(6); await press("v", CTRL);
r = await until((x) => (x.sounds ?? []).length === 4);
const newRows = (r.sounds ?? []).filter((s) => !["s0", "s1"].includes(s.id));
check(new Set(newRows.map((s) => s.row)).size === 2 && newRows.every((s) => s.end === 12), `overlapping sounds paste on two new rows at full length (${JSON.stringify(newRows.map((s) => [s.at, s.end, s.row]))})`);
await seed([C("cg", "green", 2, 2), C("cb", "blue", 3)], [T("ta", "Text A", 5, 8)]); await open();
cl = await clipLabels();
await click(cl[1]); await click("Text: Text A", CTRL); await press("c", CTRL); await press("esc"); await press("home"); await press("v", CTRL);
r = await until((x) => x.demo.clips.length === 3 && x.texts.length === 2);
check(r.texts.some((t) => t.start === 3 && t.end === 6), `magnet off: the pasted caption starts with its clip at 3 s (${r.texts.map((t) => t.start)})`);
await seed(three(), [T("tb", "Text B", 6, 9)], [S("sb", 6, 9, 1)]); await open();
cl = await clipLabels();
await click(cl[1]); await press("c", CTRL); await press("esc"); await playhead(5); await press("v", CTRL);
r = await until((x) => x.demo.clips.length === 4);
check((r.sounds ?? []).some((s) => s.id === "sb" && s.at === 9), `a clip inserted before blue moves blue's sound with it (${JSON.stringify((r.sounds ?? []).map((s) => s.at))})`);

// 6. Ctrl-click a caption on the video preview adds it to the selection.
await seed(three(), texts4()); await open();
await click("Text: Text B"); await playhead(4);
const pv = await ev(`(()=>{const e=[...document.querySelectorAll('[role=dialog] [class*="group/text"]')].find(x=>x.textContent.includes('Text A'));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
if (pv) { await mouse(pv, CTRL); await sleep(400); }
check(Boolean(pv) && (await pressed()).length === 2, "Ctrl-click a caption on the video joins the selection");

// 7. New video opens at once; a failed create offers Try again on the same video; hover, rename, open: new title.
await send("Page.navigate", { url: `${B}/studio` });
await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('New video'))`, 120000);
// A fresh dev server compiles and hydrates first: click until the page responds, and time the click that worked.
const newVideo = async () => {
  for (let i = 0; i < 20; i++) {
    const t = Date.now();
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('New video'))?.click()`);
    if ((await waitFor(`location.pathname.startsWith('/studio/') && location.pathname.length > 20`, 3000)) >= 0) return Date.now() - t;
  }
  return -1;
};
const warm = await newVideo(); // the first one also compiles the video page
check(warm >= 0, "New video works once the page is ready");
// Hold the create's answer: the page must open that video while the server has not answered yet.
await send("Page.navigate", { url: `${B}/studio` });
await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('New video'))`, 120000); await sleep(1500);
await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/runs?view=editor*", requestStage: "Request" }] });
const held = [];
const holder = (m) => { if (m.method === "Fetch.requestPaused" && m.params.request.method === "POST") held.push(m.params); };
handlers.push(holder);
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('New video')).click()`);
const navMs = await waitFor(`location.pathname.startsWith('/studio/') && location.pathname.length > 20`, 10000);
const heldId = held[0] ? JSON.parse(held[0].request.postData).id : null;
const newId = await ev(`location.pathname.split('/').pop()`);
check(held.length === 1 && navMs >= 0, `New video opens its page while the create is still unanswered (${navMs} ms, ${held.length} held)`);
check(heldId === newId, "the page is the video being created (same id)");
check((await ev(`document.body.innerText.includes("Couldn't")`)) === false, "no error while the create is pending");
handlers.splice(handlers.indexOf(holder), 1);
for (const h of held) await send("Fetch.continueRequest", { requestId: h.requestId });
await send("Fetch.disable");
check(Boolean((await until((x) => x?.id === newId, newId, "the created video"))?.id), "once answered, the video exists on the server");
check((await waitFor(`!!document.querySelector('input') && !document.body.innerText.includes("Couldn't")`, 20000)) >= 0, "and the page shows it");
await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/runs?view=editor*", requestStage: "Request" }] });
let failNext = true;
const failer = async (m) => { if (m.method !== "Fetch.requestPaused") return; if (failNext && m.params.request.method === "POST") await send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 503, body: Buffer.from("{}").toString("base64") }); else await send("Fetch.continueRequest", { requestId: m.params.requestId }); };
handlers.push(failer);
await send("Page.navigate", { url: `${B}/studio` });
await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('New video'))`, 60000); await sleep(1500);
await newVideo();
check((await waitFor(`document.body.innerText.includes("Couldn't create the video")`, 20000)) >= 0, "a failed create shows Try again");
const failId = await ev(`location.pathname.split('/').pop()`);
failNext = false;
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Try again').click()`);
check(Boolean((await until((x) => Boolean(x?.id), failId))?.id), "Try again creates that same video");
handlers.splice(handlers.indexOf(failer), 1); await send("Fetch.disable");
await send("Page.navigate", { url: `${B}/studio` });
await waitFor(`document.querySelectorAll('a[href^="/studio/"] [role=button]').length > 0`, 60000); await sleep(1000);
const card = await ev(`(()=>{const a=document.querySelector('a[href="/studio/${RID}"]');const r=a.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/3}})()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: card.x, y: card.y }); await sleep(800);
await ev(`document.querySelector('a[href="/studio/${RID}"] [role=button]').click()`); await sleep(300);
const name = "Renamed " + Date.now();
await send("Input.insertText", { text: name });
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await until((x) => x.title === name);
await ev(`document.querySelector('a[href="/studio/${RID}"]').click()`);
await waitFor(`location.pathname === '/studio/${RID}'`, 20000); await sleep(2500);
check(await ev(`[...document.querySelectorAll('input')].some(i=>i.value===${JSON.stringify(name)})`), "hover, rename, open: the editor shows the new title");

clearTimeout(watchdog);
chrome.kill();
console.log(failures.length ? `browser checks: ${failures.length} FAILED, ${passed} passed` : `browser checks: ${passed} checks pass`);
process.exit(failures.length ? 1 : 0);
