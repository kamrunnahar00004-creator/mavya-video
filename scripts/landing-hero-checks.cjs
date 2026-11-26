// Landing hero says plainly what Mavya does (founder, 2026-11-24).
const fs = require("fs");
const assert = require("assert");
const landing = fs.readFileSync("src/components/landing.tsx", "utf8");
const page = fs.readFileSync("src/app/page.tsx", "utf8");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
ok(landing.includes("Turn your app demo"), "hero line 1");
ok(landing.includes("into a viral reel"), "hero line 2");
ok(landing.includes("Pick a reel that already went viral. Mavya rewrites its script for your app and makes your reel in under 2 minutes."), "subhead (founder 2026-11-26: says the script is rewritten for your app)");
ok(!landing.includes("AI made building easy"), "old slogan gone from hero");
ok(page.includes('title: "Mavya: turn your app demo into a viral reel"'), "page title");
ok(!/[–—]/.test(landing + page), "no em/en dashes");
ok(/<h1 className="[^"]*tracking-\[-0\.02em\]/.test(landing), "hero tracking -0.02em");
const pair = fs.readFileSync("src/components/hook-pair.tsx", "utf8");
// Three before/after pairs: the original viral hook and the founder's posted Mavya hook with its own subtitle (2026-11-24).
const pairs = [1, 2, 3];
ok(pairs.every((n) => landing.includes(`src: "/landing/pair${n}-before.mp4"`) && landing.includes(`src: "/landing/pair${n}-after.mp4"`)), "three before/after pairs");
for (const n of pairs) for (const f of [`pair${n}-before.mp4`, `pair${n}-before.webp`, `pair${n}-after.mp4`, `pair${n}-after.webp`]) ok(fs.existsSync("public/landing/" + f), f + " exists");
ok(["5M", "1.6M", "443K"].every((v) => landing.includes(`label: "Viral hook, ${v} views"`)), "view counts on each original");
ok(!/side\.caption|caption:/.test(pair + landing), "no typed subtitle over the Mavya hook: the posted one carries its own");
ok(landing.includes('href="/landing/pair1-before.webp" fetchPriority="high"') && landing.includes('href="/landing/pair1-after.webp" fetchPriority="high"'), "preloads first pair posters");
ok(!landing.includes("lib-DcOiTp0xxTK.webp"), "old hero preload gone");
// Sync rules: the two hooks restart together and the copy follows the original's clock.
ok(/addEventListener\("ended", onEnd\)/.test(pair) && /currentTime = 0/.test(pair), "hooks restart in lockstep");
ok(!/\bloop\b/.test(pair.replace(/\/\*[\s\S]*?\*\//g, "")), "no independent loop attribute");
ok(/vb\.currentTime = va\.currentTime/.test(pair), "copy follows the original clock");
// Codex 2026-11-24: cross-pausing on "waiting" could freeze both; scroll jitter must not rewind.
ok(!/addEventListener\("waiting"/.test(pair), "no cross-pause on waiting");
ok(/visible && !was/.test(pair), "rewind only on re-entering view");
ok(/v\.preload = "auto"/.test(pair) && /v\.load\(\)/.test(pair), "files actually load before play");
// Slideshow: square dots pick a pair; each pair plays PLAYS_PER_PAIR times then the next shows.
ok(/export const PLAYS_PER_PAIR = 2;/.test(pair) && /plays >= PLAYS_PER_PAIR\) \{ done\.current\(\)/.test(pair), "advances after two plays");
ok(/<HookPair key=\{index\}/.test(pair), "each pair remounts so its sync state starts fresh");
ok(/aria-current=\{i === index\}/.test(pair) && /h-3 w-3 border-2 border-ink/.test(pair) && !/rounded/.test(pair), "square dots, current one marked");
// Codex 2026-11-24: a chosen example stays put; a failed clip does not strand the slideshow.
ok(/onClick=\{\(\) => \{ setAuto\(false\); setIndex\(i\); \}\}/.test(pair) && /if \(auto\) setIndex/.test(pair), "picking a dot stops rotation");
ok(/addEventListener\("error", onError\)/.test(pair) && /clearTimeout\(failed\)/.test(pair), "failed clip moves on");
// Each pair's clips must be the same length (within 0.1 s) or the lockstep restart cuts one short.
const dur = (f) => { const b = fs.readFileSync("public/landing/" + f); const i = b.indexOf("mvhd"); const v = b[i + 4]; const scale = v === 1 ? b.readUInt32BE(i + 24) : b.readUInt32BE(i + 16); const len = v === 1 ? Number(b.readBigUInt64BE(i + 28)) : b.readUInt32BE(i + 20); return len / scale; };
// Founder 2026-11-24: the posted pair 1 hook starts 2.13 s into the Kling clip, so the original is cut from there too.
ok(/1: Dd--YQOqo16 \(@creativeinezz\) from 2\.13 s/.test(landing), "pair 1 original offset matches the posted cut");
// Founder 2026-11-24: pair 2's Mavya side is the "Insta + App" reel (Olivia), not the POV reel that looks like the original.
ok(/2: DaFCnEnNxTM .* IG 17895093048620048/.test(landing) && Math.abs(dur("pair2-after.mp4") - 2.6) < 0.1, "pair 2 uses the Insta + App reel");
for (const n of pairs) ok(Math.abs(dur(`pair${n}-before.mp4`) - dur(`pair${n}-after.mp4`)) < 0.1, `pair ${n} clips equal length`);
// Square like the rest of the landing: ink border, hard offset shadow, no rounded corners (founder, 2026-11-24).
ok(/data-hook-pair className="[^"]*border-2 border-ink[^"]*shadow-\[6px_6px_0_var\(--ink\)\]/.test(pair) && !/keep-round|rounded-/.test(pair), "hook card is square");
// How it works, "Film your demo" step copy (founder, 2026-11-24).
ok(fs.readFileSync("src/components/how-it-works.tsx", "utf8").includes('body: "Get a viral script for your app, shot by shot. Film it on your phone in a minute."'), "film your demo copy");
ok(fs.readFileSync("src/components/how-it-works.tsx", "utf8").includes('body: "Hooks with millions of views. Pick your favorite."'), "find your hook copy");
console.log(`landing-hero-checks: ${n} passed`);
