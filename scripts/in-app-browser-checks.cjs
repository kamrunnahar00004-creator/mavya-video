// In-app browsers (founder 2026-11-26): inside Instagram / Facebook / TikTok, ask to open Mavya in the real browser
// (Google blocks its sign-in there; Apple Pay is often missing). Detection and the escape links. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.equal(JSON.stringify(a), JSON.stringify(b), m); };
const b = load('src/lib/in-app-browser.ts');
const UA = {
  igIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 356.0.0.32.88 (iPhone15,3; iOS 18_1; en_US)',
  igAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Instagram 356.0.0.32.88 Android',
  fbIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 [FBAN/FBIOS;FBAV/490.0.0.40.108;FBBV/123]',
  tiktok: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 musical_ly_2023709030 BytedanceWebview/d8a21c6',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
};
eq(b.inAppBrowser(UA.igIos), { app: 'Instagram', os: 'ios' }, 'Instagram on iPhone');
eq(b.inAppBrowser(UA.igAndroid), { app: 'Instagram', os: 'android' }, 'Instagram on Android');
eq(b.inAppBrowser(UA.fbIos), { app: 'Facebook', os: 'ios' }, 'Facebook on iPhone');
eq(b.inAppBrowser(UA.tiktok), { app: 'TikTok', os: 'android' }, 'TikTok on Android');
for (const k of ['safari', 'chrome', 'desktop']) eq(b.inAppBrowser(UA[k]), null, `no banner in a normal browser (${k})`);
const href = 'https://mavya.app/?utm_source=meta&fbclid=abc123';
const android = b.openInBrowserUrl(href, 'android');
ok(android.startsWith('intent://mavya.app/?utm_source=meta&fbclid=abc123#Intent;scheme=https;package=com.android.chrome;') && android.includes('S.browser_fallback_url=' + encodeURIComponent(href)), 'Android: Chrome by intent, keeping the page, the ad\'s fbclid and UTMs, with a fallback');
eq(b.openInBrowserUrl(href, 'ios'), 'x-safari-https://mavya.app/?utm_source=meta&fbclid=abc123', 'iPhone: Safari\'s own link, keeping the fbclid and UTMs');
eq(b.openInBrowserUrl(href, 'other'), null, 'unknown system: no jump, the manual tip instead');
eq(b.openInBrowserUrl('javascript:alert(1)', 'ios'), null, 'never a script link');
const comp = fs.readFileSync('src/components/open-in-browser.tsx', 'utf8');
ok(/inAppBrowser\(navigator\.userAgent\)/.test(comp) && /setTried\(true\), 1200/.test(comp) && /Open in \{env\.os === "android" \? "Chrome" : "external browser"\}/.test(comp), 'blocked jump: shows the app menu way (Instagram: "Open in external browser")');
ok(/aria-label="Close"/.test(comp) && /<OpenInBrowser \/>/.test(fs.readFileSync('src/app/layout.tsx', 'utf8')), 'on every page, and it can be closed');
ok(/const open = \(\) => \{[\s\S]{0,200}openInBrowserUrl\(window\.location\.href, env\.os\)/.test(comp), 'the link is built at the click, from the page shown then (not a stale one)');
ok(!/[—–]/.test(comp + fs.readFileSync('src/lib/in-app-browser.ts', 'utf8')), 'no em or en dashes');
assert.equal(checks, 15);
console.log(`in-app-browser-checks: ${checks} checks pass`);
