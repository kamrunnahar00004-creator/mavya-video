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
// Founder 2026-11-27: no banner (looked suspicious, cost taps). The Google button itself opens the real browser.
const modal = fs.readFileSync('src/components/auth-modal.tsx', 'utf8');
const layout = fs.readFileSync('src/app/layout.tsx', 'utf8');
ok(!/OpenInBrowser/.test(layout) && !fs.existsSync('src/components/open-in-browser.tsx'), 'no open-in-browser banner on any page');
ok(/inAppBrowser\(navigator\.userAgent\)/.test(modal) && /if \(env\) return googleInBrowser\(env\);/.test(modal), 'in-app: the Google button never starts Google there (403), it jumps out');
ok(/searchParams\.set\("google", "1"\)/.test(modal) && /searchParams\.set\("next", next\)/.test(modal) && /openInBrowserUrl\(here\.toString\(\), env\.os\)/.test(modal), 'the jump reopens this popup with google=1 and the same next, keeping the ad\'s fbclid and UTMs');
ok(/autoGoogle && !initialError && !autoStarted\.current/.test(modal) && /else if \(autoGoogle/.test(modal), 'real browser: Google starts once by itself, never inside the app, never again after a failed sign-in');
ok(/setJumpFailed\(true\)/.test(modal) && /inApp\.os === "android" \? "Open in Chrome" : "Open in external browser"/.test(modal) && /" \(or your browser\)"/.test(modal) && /Or sign up with email below\./.test(modal), 'blocked jump: shows the app menu way and points to email');
ok(!/[\u2014\u2013]/.test(modal + fs.readFileSync('src/lib/in-app-browser.ts', 'utf8')), 'no em or en dashes');
ok(/const env = inApp \?\? \(typeof navigator === "undefined" \? null : inAppBrowser\(navigator\.userAgent\)\);/.test(modal), 'a tap before detection commits still never starts Google in the app');
ok(/url\.searchParams\.delete\("google"\);[\s\S]{0,80}history\.replaceState/.test(modal), 'google=1 is used once (Back does not restart Google)');
ok(/if \(env\) queueMicrotask\(\(\) => \{ setInApp\(env\); if \(autoGoogle\) setJumpFailed\(true\); \}\)/.test(modal), 'jump fell back into the app: the tip shows');
ok(/here\.searchParams\.delete\("error"\)/.test(modal), 'an old error never blocks the Google start over there');
ok(/sessionStorage\.setItem\(AD_KEY/.test(modal) && /AD_PARAM = \/\^\(fbclid\|utm_\[a-z_\]\+\)\$\//.test(modal) && /!here\.searchParams\.has\(k\)\) here\.searchParams\.set\(k, v\)/.test(modal), 'the ad\'s fbclid and UTMs from the landing page go along, even after the header link dropped them');
ok(/history\.replaceState\(null, "", stay\);[\s\S]{0,40}setJumpFailed\(true\)/.test(modal), 'blocked jump: the address keeps the ad codes, so opening it from the app menu still counts');
ok(/if \(autoGoogle && !env\) \{/.test(modal), 'google=1 stays while still in the app (menu open starts Google), is removed in the real browser');
ok(/gone\.current = true; if \(jumpTimer\.current\) clearTimeout\(jumpTimer\.current\);/.test(modal) && /jumpTimer\.current = setTimeout\(/.test(modal), 'closing the popup cancels the blocked-jump timer (no old address put back)');
ok(/await showPending\(\);\s*\/\/ Closed while[^\n]*\n\s*if \(gone\.current\) return;/.test(modal), 'closing the popup while Google starts cancels it');
ok(!/replaceState\(window\.history\.state/.test(modal), 'address changes use replaceState(null), so Next.js keeps its search params in sync');
ok(/skipBrowserRedirect: true/.test(modal) && /if \(gone\.current\) return;\s*window\.location\.assign\(data\.url\);/.test(modal), 'Mavya goes to Google itself, only while the popup is still open');
ok(/if \(auth\) stay\.searchParams\.set\("auth", auth\);/.test(modal), 'blocked jump never changes auth in the address (no popup reset)');
ok(/addEventListener\("pageshow", back\)/.test(modal) && /if \(e\.persisted\) setLoading\(false\)/.test(modal), 'Back from Google: buttons work again');
assert.equal(checks, 30);
console.log(`in-app-browser-checks: ${checks} checks pass`);
