// Landing hero says plainly what Mavya does (founder, 2026-11-24).
const fs = require("fs");
const assert = require("assert");
const landing = fs.readFileSync("src/components/landing.tsx", "utf8");
const page = fs.readFileSync("src/app/page.tsx", "utf8");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
ok(landing.includes("Turn your app demo"), "hero line 1");
ok(landing.includes("into a viral reel"), "hero line 2");
ok(landing.includes("Pick a viral video. Add your app. Your reel is ready in under 2 minutes."), "subhead");
ok(!landing.includes("AI made building easy"), "old slogan gone from hero");
ok(page.includes('title: "Mavya: turn your app demo into a viral reel"'), "page title");
ok(!/[–—]/.test(landing + page), "no em/en dashes");
ok(/<h1 className="[^"]*tracking-\[-0\.02em\]/.test(landing), "hero tracking -0.02em");
const pair = fs.readFileSync("src/components/hook-pair.tsx", "utf8");
ok(landing.includes('label: "Viral hook, 5M views"') && landing.includes('label: "Made with Mavya"'), "before/after labels");
ok(landing.includes('src: "/landing/ba-before.mp4"') && landing.includes('src: "/landing/ba-after.mp4"'), "before/after hook clips");
for (const f of ["ba-before.mp4", "ba-before.webp", "ba-after.mp4", "ba-after.webp"]) ok(fs.existsSync("public/landing/" + f), f + " exists");
ok(landing.includes('href="/landing/ba-before.webp" fetchPriority="high"') && landing.includes('href="/landing/ba-after.webp" fetchPriority="high"'), "preloads both hero posters");
ok(!landing.includes("lib-DcOiTp0xxTK.webp"), "old hero preload gone");
// The two hooks restart together when the original ends, so they never drift apart (founder, 2026-11-24).
ok(/addEventListener\("ended", onEnd\)/.test(pair) && /currentTime = 0/.test(pair), "hooks restart in lockstep");
ok(!/\bloop\b/.test(pair.replace(/\/\*[\s\S]*?\*\//g, "")), "no independent loop attribute");
ok(/vb\.currentTime = va\.currentTime/.test(pair), "copy follows the original clock");
// Codex 2026-11-24: cross-pausing on "waiting" could freeze both; scroll jitter must not rewind.
ok(!/addEventListener\("waiting"/.test(pair), "no cross-pause on waiting");
ok(/visible && !was/.test(pair), "rewind only on re-entering view");
ok(/v\.preload = "auto"/.test(pair) && /v\.load\(\)/.test(pair), "files actually load before play");
// Both clips must be the same length (within 0.1 s) or the lockstep restart cuts one short.
const dur = (f) => { const b = fs.readFileSync("public/landing/" + f); const i = b.indexOf("mvhd"); const v = b[i + 4]; const scale = v === 1 ? b.readUInt32BE(i + 24) : b.readUInt32BE(i + 16); const len = v === 1 ? Number(b.readBigUInt64BE(i + 28)) : b.readUInt32BE(i + 20); return len / scale; };
ok(Math.abs(dur("ba-before.mp4") - dur("ba-after.mp4")) < 0.1, "hook clips equal length");
// Square like the rest of the landing: ink border, hard offset shadow, no rounded corners (founder, 2026-11-24).
ok(/data-hook-pair className="[^"]*border-2 border-ink[^"]*shadow-\[6px_6px_0_var\(--ink\)\]/.test(pair) && !/keep-round|rounded-/.test(pair), "hook card is square");
console.log(`landing-hero-checks: ${n} passed`);
