// Actual proxy session gate, with a 250 ms offline allowance transport. No credentials or network.
const assert = require('node:assert/strict'), { performance } = require('node:perf_hooks'), fs = require('node:fs');
const { load } = require('./check-module.cjs');
const cookies = () => ({ getAll: () => [], set() {} });
let plan = 'starter', reads = 0;
const api = load('src/lib/supabase/session.ts', {
  'next/server': { NextResponse: { next: () => ({ status: 200, cookies: cookies() }), redirect: to => ({ status: 307, location: String(to), cookies: cookies() }) } },
  '@supabase/ssr': { createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'fixture-owner' } } }) } }) }
}, { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture' }, {
  fetch: async () => { reads++; await new Promise(resolve => setTimeout(resolve, 250)); return Response.json({ plan }); }
});
(async () => {
  const rows = [];
  for (let round = 0; round < 3; round++) for (const path of ['/studio', '/library', '/studio/fixture']) {
    const url = new URL('http://fixture' + path), start = performance.now();
    const result = await api.updateSession({ url: url.href, nextUrl: url, cookies: cookies() });
    assert.equal(result.status, 200); rows.push({ round, path, milliseconds: performance.now() - start });
  }
  plan = null;
  const url = new URL('http://fixture/studio');
  const revoked = await api.updateSession({ url: url.href, nextUrl: url, cookies: cookies() });
  assert.equal(revoked.status, 307); assert.equal(revoked.location, 'http://fixture/pricing'); assert.equal(reads, 10);
  const result = { profile: 'Offline actual updateSession, claims stub, transport delay 250 ms, nine allowed navigation calls followed by an unusable plan. No production latency claim.', rows, medianMs: rows.map(r => r.milliseconds).sort((a, b) => a - b)[4], reads, unusablePlanRedirect: revoked.location };
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
