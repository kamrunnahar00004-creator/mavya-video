// Meta Pixel signup tracking (founder 2026-11-07): the Pixel id check, the new-account window, the Europe time-zone
// gate, the dedup event id, the cookie reader, and /auth/continue setting the signup cookie only for a new account
// while keeping its redirects. Offline.
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 26;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.equal(a, b, msg); };

const globals = { crypto: globalThis.crypto, Uint8Array, Array };
const px = load('src/lib/meta-pixel.ts', {}, {}, globals);

finish('meta-pixel-checks', EXPECTED, () => checks, async () => {
  // Pixel id: digits only (it goes into an inline script).
  eq(px.pixelId(' 1234567890123456 '), '1234567890123456', 'trimmed numeric id accepted');
  eq(px.pixelId(undefined), null, 'unset id: Pixel off');
  eq(px.pixelId(''), null, 'empty id: Pixel off');
  eq(px.pixelId('123");alert(1);//'), null, 'script injection rejected');

  // New-account window.
  const now = Date.parse('2026-11-07T12:00:00Z');
  ok(px.isNewSignup('2026-11-07T11:59:30Z', now), 'created 30 s ago: new');
  ok(px.isNewSignup('2026-11-07T11:50:00Z', now), 'created exactly 10 min ago: new');
  ok(!px.isNewSignup('2026-11-07T11:49:59Z', now), 'created over 10 min ago: returning login');
  ok(!px.isNewSignup('2026-11-02T01:45:00Z', now), 'old account: not new');
  ok(px.isNewSignup('2026-11-07T12:00:30Z', now), 'small clock skew still new');
  ok(!px.isNewSignup('2026-11-07T13:00:00Z', now), 'far-future time: not new');
  ok(!px.isNewSignup(undefined, now) && !px.isNewSignup('garbage', now), 'missing or bad time: not new');

  // Europe gate.
  ok(px.pixelAllowed('America/New_York') && px.pixelAllowed('America/Los_Angeles'), 'US: Pixel on');
  ok(px.pixelAllowed('Asia/Tokyo') && px.pixelAllowed('Asia/Dhaka'), 'Asia: Pixel on');
  ok(!px.pixelAllowed('Europe/London') && !px.pixelAllowed('Europe/Berlin') && !px.pixelAllowed('Europe/Zurich'), 'UK, EU, CH: Pixel off');
  ok(!px.pixelAllowed('Atlantic/Canary') && !px.pixelAllowed('Atlantic/Reykjavik'), 'EEA islands: Pixel off');
  ok(!px.pixelAllowed(undefined) && !px.pixelAllowed(''), 'unknown time zone: Pixel off');

  // Event id: stable per account, different across accounts, no raw user id.
  const uid = 'c4d71805-588e-4af9-acf0-d42b7eb80941';
  const a = await px.signupEventId(uid), b = await px.signupEventId(uid), c = await px.signupEventId('d9e20ba7-f9ee-4e2b-8942-f22f1a5521e1');
  ok(/^signup-[0-9a-f]{24}$/.test(a) && a === b, 'event id stable and well-formed');
  ok(a !== c && !a.includes('c4d71805'), 'event id differs per account and hides the user id');

  // Cookie reader.
  eq(px.readSignupCookie(`foo=1; mv_signup=${a}; bar=2`), a, 'cookie found among others');
  eq(px.readSignupCookie(`mv_signup=${a}`), a, 'cookie alone');
  eq(px.readSignupCookie('mv_signup=<script>'), null, 'foreign value ignored');
  eq(px.readSignupCookie('xmv_signup=signup-' + 'a'.repeat(24)), null, 'similar cookie name ignored');

  // /auth/continue: cookie only for a new account, redirects unchanged.
  const nextServer = require('next/server');
  async function run(user, plan) {
    const route = load('src/app/auth/continue/route.ts', {
      'next/server': nextServer,
      '@/lib/auth-next': { safeNext: (n) => n || '/studio' },
      '@/lib/server/usage': { allowance: async () => (plan ? { plan: 'starter', limit: 10 } : { plan: null, limit: 0 }) },
      '@/lib/supabase/server': { getSessionUser: async () => user },
      '@/lib/server/billing-state': { billingRow: async () => null },
      '@/lib/meta-pixel': px,
    }, {}, globals);
    return route.GET(new nextServer.NextRequest('https://mavya.app/auth/continue?next=%2Fstudio'));
  }
  const fresh = { id: uid, created_at: new Date(Date.now() - 20_000).toISOString() };
  const old = { id: uid, created_at: '2026-10-01T00:00:00Z' };
  const r1 = await run(fresh, false);
  eq(r1.headers.get('location'), 'https://mavya.app/pricing', 'new account without a plan still goes to Pricing');
  ok((r1.headers.get('set-cookie') || '').includes(`mv_signup=${a}`), 'new account gets the signup cookie');
  const r2 = await run(old, true);
  ok(r2.headers.get('location') === 'https://mavya.app/studio' && !(r2.headers.get('set-cookie') || '').includes('mv_signup'), 'returning login: no cookie, normal redirect');
  const r3 = await run(null, false);
  ok(r3.headers.get('location') === 'https://mavya.app/?auth=login' && !(r3.headers.get('set-cookie') || '').includes('mv_signup'), 'signed out: login, no cookie');
});
