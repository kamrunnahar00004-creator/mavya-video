// Faster pages (founder 2026-11-10: "anything to make it faster. do it"). From Japan, the hook library list cost
// 0.5-1.4 s on every Videos/Library load and profile/usage were fetched again on every click. Now: the browser keeps
// the curated catalog (private, 5 min fresh, then stale-while-revalidate), an edit bypasses that cache, the request
// starts with the HTML, and the sidebar chip and Settings pages show the last values while they refresh. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 20;
const eq = (a, b, msg) => { checks++; assert.equal(a, b, msg); };
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

finish('speed-cache-checks', EXPECTED, () => checks, async () => {
  // The route: only the first page of the curated catalog is browser-cacheable, never by a shared cache.
  let who = 'user-1';
  const route = load('src/app/api/references/route.ts', {
    '@/lib/server/list-pages': {
      listPage: async () => ({ items: [{ id: 'a', owner: 'curated', partial: true }], next: null }),
      pageResponse: (items) => Response.json(items),
      listError: () => Response.json({ error: 'x' }, { status: 500 }),
    },
    'next/server': { connection: async () => undefined },
    '@/lib/server/store': { createReference: async () => ({}), mediaAccess: async () => null },
    '@/lib/server/who': { currentUser: async () => who, signInFirst: () => Response.json({ error: 'Sign in first.' }, { status: 401 }) },
    '@/lib/taxonomy': { HOOK_STYLES: [], NICHES: [] },
  });
  const cc = async (url) => (await route.GET(new Request('https://mavya.app' + url))).headers.get('cache-control');
  const first = await route.GET(new Request('https://mavya.app/api/references?view=catalog&scope=curated&all=1'));
  eq(first.headers.get('cache-control'), 'private, max-age=300, stale-while-revalidate=1200', 'the catalog is kept by the browser');
  eq(first.headers.get('vary'), 'Cookie', 'only inside the same signed-in session (sign-out or another account misses it)');
  // Signed media links can arrive with half their hour left; the cached list must be older than that never.
  const r2 = fs.readFileSync('src/lib/server/r2.ts', 'utf8');
  const life = Number(r2.match(/export function signedGet\(key: string, seconds = (\d+)/)[1]);
  const [, fresh, stale] = first.headers.get('cache-control').match(/max-age=(\d+), stale-while-revalidate=(\d+)/).map(Number);
  ok(/Keep at least half the original lifetime/.test(r2) && fresh + stale < life / 2, `cached at most ${fresh + stale} s, under the ${life / 2} s a link may have left`);
  ok(!/public|s-maxage/.test(await cc('/api/references?view=catalog&scope=curated&all=1')), 'never a shared CDN cache');
  eq(await cc('/api/references?view=catalog&scope=curated&all=1&cursor=abc'), null, 'continuations stay fresh');
  eq(await cc('/api/references?view=cards'), null, 'owned lists are not cached');
  who = null;
  eq(await cc('/api/references?view=catalog&scope=curated&all=1'), null, 'a signed-out request is never cacheable');

  // The client cache: an edit makes the next catalog request skip the browser cache, also after a failure.
  const calls = [];
  let fail = false;
  const lib = load('src/lib/library-cache.ts', {
    '@/lib/list-client': { fetchPage: async (url, cursor, cache) => { calls.push(cache); if (fail) throw Error('down'); return { items: [{ id: 'a', owner: 'curated', partial: true }], next: null }; } },
  }, {}, { performance: { now: () => Date.now() } });
  await lib.loadLibrary();
  await lib.loadLibrary();
  lib.invalidateLibrary();
  fail = true;
  await lib.loadLibrary().catch(() => undefined);
  fail = false;
  await lib.loadLibrary();
  await lib.loadLibrary();
  eq(calls.map((c) => c ?? 'default').join(), 'default,reload,reload', 'first load uses the browser cache; after an edit (and a failed retry) the next load reloads; within 60 s no request');

  const src = (f) => fs.readFileSync(f, 'utf8');
  for (const page of ['src/app/(app)/studio/page.tsx', 'src/app/(app)/library/page.tsx']) {
    ok(/preload\(URL_CATALOG, \{ as: "fetch", crossOrigin: "anonymous" \}\);/.test(src(page)), `${page} starts the catalog request with the HTML`);
  }
  ok(/export const URL_CATALOG = "\/api\/references\?view=catalog&scope=curated&all=1";/.test(src('src/lib/library-cache.ts')), 'the preload and the fetch use one URL');

  const chip = src('src/components/account-chip.tsx');
  ok(/useState<Profile>\(lastProfile\.get\(\) \?\? NO_PROFILE\)/.test(chip) && /useState<string \| null>\(lastPlan\.get\(\)\)/.test(chip) && /const profileTicket = lastProfile\.ticket\(\);\s*fetch\("\/api\/profile"\)/.test(chip) && /if \(lastProfile\.write\(profileTicket, p\) && alive\) setProfile\(p\)/.test(chip) && /const planTicket = lastPlan\.ticket\(\);\s*fetch\("\/api\/usage"\)/.test(chip), 'the chip shows the last profile and plan, refreshes, and only its newest request writes them');

  const shell = src('src/components/settings-shell.tsx');
  ok(/const seen = withBilling \? null : lastUsage\.get\(\);/.test(shell) && /useState<Billing \| null>\(null\)/.test(shell) && /const ticket = lastUsage\.ticket\(\);[\s\S]{0,200}if \(u\) lastUsage\.write\(ticket, u\);/.test(shell), 'Plans and Billing never start from saved values; saved usage is written by the newest request only');
  ok(/const reload = useCallback\(\(\) => load\(false\), \[load\]\);/.test(shell) && /void load\(quietOnMount\.current\);/.test(shell) && /accountLoader\(/.test(shell), 'Usage refreshes quietly on mount; reload() is a real load');

  // The loader with responses that arrive later, in the order the test chooses.
  const { accountLoader } = load('src/lib/account-loader.ts');
  const pending = [];
  const log = [];
  const loader = accountLoader(() => new Promise((resolve) => pending.push(resolve)), { begin: () => log.push('begin'), commit: (v) => log.push('commit ' + v) });
  const quiet = loader(true);
  const real = loader(false);
  eq(pending.length, 1, 'a real load waits for the quiet one instead of racing it');
  pending[0]('old');
  await quiet;
  await new Promise((r) => setTimeout(r, 0));
  eq(pending.length, 2, 'then fetches again');
  pending[1]('new');
  eq(await real, 'new', 'the real load returns the fresh snapshot');
  eq(log.join(','), 'begin,commit new', 'the older quiet snapshot never shows; loading shows once');
  const a = loader(false), b = loader(true);
  pending[2]('x');
  ok((await a) === 'x' && (await b) === 'x' && pending.length === 3, 'a quiet load during a real one reuses it');

  // Shared across mounts: responses landing in reverse order never let the older one win.
  const { newestWrites } = load('src/lib/account-loader.ts');
  const shared = newestWrites();
  const older = shared.ticket(), newer = shared.ticket();
  ok(shared.write(newer, 'new') && !shared.write(older, 'old') && shared.get() === 'new', 'an older response from a closed page cannot overwrite a newer one');
});
