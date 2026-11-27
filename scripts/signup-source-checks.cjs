// Signup source (founder 2026-11-27, paid Meta ads): the ad's codes from the first tagged visit are kept in a cookie and
// saved on the new account, so ad signups can be told apart from post signups. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.equal(JSON.stringify(a), JSON.stringify(b), m); };

const ft = load('src/lib/first-touch.ts', {}, {}, { URLSearchParams, decodeURIComponent, encodeURIComponent, Date, JSON });
const now = new Date('2026-11-27T12:00:00Z');

finish('signup-source-checks', 19, () => checks, async () => {
  const s = ft.sourceFromSearch('?utm_source=meta&utm_medium=paid&utm_campaign=Mavya%20%7C%20Signups%20%7C%20Nov%2027&utm_content=500%20users%20reel%20v1&fbclid=IwAR0abc-123_x', now);
  const big = ft.sourceFromSearch('?' + ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'].map(k => k + '=' + encodeURIComponent('日本'.repeat(50))).join('&') + '&fbclid=' + 'f'.repeat(200), now);
  const bigCookie = ft.writeSource(big);
  ok(bigCookie.length <= 3000 && ft.readSource(bigCookie).fbclid === 'f'.repeat(200) && ft.readSource(bigCookie).utm_source.length > 0, 'long non-Latin names: cookie stays under the browser limit, fbclid kept whole');
  eq(s, { at: '2026-11-27T12:00:00.000Z', utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'Mavya | Signups | Nov 27', utm_content: '500 users reel v1', fbclid: 'IwAR0abc-123_x' }, 'the ad\'s codes from the landing page, campaign and ad names kept readable');
  eq(ft.sourceFromSearch('?auth=signup&next=%2Fvideos', now), null, 'a visit without ad codes sets nothing');
  eq(ft.sourceFromSearch('', now), null, 'no query: nothing');
  eq(ft.sourceFromSearch('?utm_source=%3Cscript%3Ealert(1)%3C%2Fscript%3E', now).utm_source, 'scriptalert1script', 'markup is stripped');
  ok(ft.sourceFromSearch('?fbclid=' + 'a'.repeat(500), now).fbclid.length === 200 && ft.sourceFromSearch('?utm_source=' + 'b'.repeat(500), now).utm_source.length === 100, 'values are capped (cookie size)');
  eq(ft.readSource(ft.writeSource(s)), s, 'cookie round trip');
  eq(ft.readSource('not json'), null, 'garbage cookie: ignored');
  eq(ft.readSource(encodeURIComponent(JSON.stringify({ utm_source: 'meta' }))), null, 'no time: ignored');
  eq(ft.readSource(encodeURIComponent(JSON.stringify({ at: 'x', utm_source: 'meta' }))), null, 'bad time: ignored');
  eq(ft.readSource(encodeURIComponent(JSON.stringify({ at: now.toISOString(), evil: 'x', utm_source: 'meta' }))), { at: now.toISOString(), utm_source: 'meta' }, 'unknown keys dropped');

  // Saving on the account: once, merged, never failing signup.
  const calls = [];
  const db = (meta, fail) => ({ auth: { admin: {
    getUserById: async (id) => ({ data: { user: { id, app_metadata: meta } }, error: null }),
    updateUserById: async (id, body) => { calls.push([id, body]); return { error: fail ? { status: 500 } : null }; },
  } } });
  const save = load('src/lib/server/signup-source.ts', { '@/lib/supabase/server': { createSupabaseAdminClient: () => null } }).saveSource;
  eq(await save('u1', s, db({ provider: 'google' })), true, 'new account: saved');
  eq(calls[0], ['u1', { app_metadata: { signup_source: s } }], 'only signup_source is written (provider info kept by the merge)');
  eq(await save('u2', s, db({ signup_source: { at: 'old' } })), false, 'already has one: kept, never overwritten');
  eq(await save('u3', s, db({}, true)), false, 'a failed save never throws (signup goes on)');

  const route = fs.readFileSync('src/app/auth/continue/route.ts', 'utf8');
  ok(/isNewSignup\(user\.created_at, Date\.now\(\)\)\)[\s\S]*readSource\(request\.cookies\.get\(SOURCE_COOKIE\)\?\.value\)[\s\S]*if \(source && beforeSignup\(source, user\.created_at\)\) after\(\(\) => saveSource\(user\.id, source\)\)/.test(route) && !/SOURCE_COOKIE, ""/.test(route), 'only a brand-new account, only a visit made before it existed, after the redirect; cookie kept so a failed save can retry');
  eq([ft.beforeSignup({ at: '2026-11-27T12:00:00Z' }, '2026-11-27T12:05:00Z'), ft.beforeSignup({ at: '2026-11-27T12:10:00Z' }, '2026-11-27T12:05:00Z')], [true, false], 'a tagged visit after the account was made never counts');
  eq(ft.sourceFromSearch('?utm_campaign=%E6%97%A5%E6%9C%AC%E3%82%AD%E3%83%A3%E3%83%B3%E3%83%9A%E3%83%BC%E3%83%B3&utm_id=120200', now), { at: now.toISOString(), utm_campaign: '日本キャンペーン', utm_id: '120200' }, 'non-Latin campaign names and utm_id kept');
  const comp = fs.readFileSync('src/components/first-touch.tsx', 'utf8');
  ok(/startsWith\(`\$\{SOURCE_COOKIE\}=`\)\)\) return;/.test(comp) && /\}, \[pathname, query\]\);/.test(comp) && /<FirstTouch \/>/.test(fs.readFileSync('src/app/layout.tsx', 'utf8')), 'first tagged visit wins (never overwritten), on every page');
});
