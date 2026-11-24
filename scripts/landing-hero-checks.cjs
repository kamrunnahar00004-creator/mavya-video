// Landing hero says plainly what Mavya does (founder, 2026-11-24).
const fs = require("fs");
const assert = require("assert");
const landing = fs.readFileSync("src/components/landing.tsx", "utf8");
const page = fs.readFileSync("src/app/page.tsx", "utf8");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
ok(landing.includes("Turn your app demo"), "hero line 1");
ok(landing.includes("into a viral reel"), "hero line 2");
ok(landing.includes("Add an AI reaction hook, drop in your screen recording and export in under 2 minutes."), "subhead");
ok(!landing.includes("AI made building easy"), "old slogan gone from hero");
ok(page.includes('title: "Mavya: turn your app demo into a viral reel"'), "page title");
ok(!/[–—]/.test(landing + page), "no em/en dashes");
ok(/<h1 className="[^"]*tracking-\[-0\.02em\]/.test(landing), "hero tracking -0.02em");
console.log(`landing-hero-checks: ${n} passed`);
