// Checkout recovery emails (founder 2026-11-27): 3 emails at ~1 h, 1 day, 3 days after an unpaid checkout expired,
// each once, only the latest checkout per person, never to someone with a trial/plan or who unsubscribed; failures
// release the claim. Offline: Stripe, Supabase and Resend are stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const EXPECTED = 22;
const tpl = load('src/lib/recovery-email.ts');
const H = 3600_000;

finish('recovery-email-checks', EXPECTED, () => checks, async () => {
  const exp = Date.parse('2026-11-27T00:00:00Z');
  ok(tpl.dueStep(exp, exp + 10 * 60_000) === 0 && tpl.dueStep(exp, exp + 25 * H) === 1 && tpl.dueStep(exp, exp + 73 * H) === 2, 'email 1 at expiry (~1 h after checkout), 2 at a day, 3 at 3 days');
  ok(tpl.dueStep(exp, exp - 60_000) === null && tpl.dueStep(exp, exp + 50 * H) === null && tpl.dueStep(exp, exp + 97 * H) === null, 'nothing due between steps, before expiry, or after the last window');

  const subjects = [0, 1, 2].map((i) => tpl.recoveryEmail(i, 'https://checkout.stripe.com/r/x', 'https://mavya.app/api/email/stop?u=a&t=b').subject);
  ok(JSON.stringify(subjects) === JSON.stringify(['you were one click away', 'i copied a 5M-view reel for my app', 'not ready for users yet?']), "the founder's three subject lines");
  const all = [0, 1, 2].map((i) => tpl.recoveryEmail(i, 'https://checkout.stripe.com/r/x', 'https://mavya.app/api/email/stop?u=a&t=b'));
  ok(all.every((m) => m.html.includes('href="https://checkout.stripe.com/r/x"') && m.html.includes('Start my 3-day free trial') && m.html.includes('Free for 3 days. Cancel anytime.') && m.text.includes('https://checkout.stripe.com/r/x')), 'every email: the recovery link button and the risk line, in HTML and text');
  ok(all.every((m) => m.html.includes('Unsubscribe') && m.text.includes('Unsubscribe: https://mavya.app/api/email/stop')), 'every email has a working unsubscribe link');
  ok(all[1].html.includes('src="https://mavya.app/email/before-after.gif"') && !all[0].html.includes('.gif') && !all[2].html.includes('.gif') && fs.statSync('public/email/before-after.gif').size < 1024 * 1024, 'only email 2 has the before/after GIF (under 1 MB, hosted on mavya.app)');
  ok(all[1].html.includes('20.2k views and 582 users') && all[1].html.includes('More posts. More views. More users.') && all[1].html.includes('You never film your face.'), "email 2 is the founder's copy");
  ok(!/[–—]/.test(all.map((m) => m.subject + m.html + m.text).join('')), 'no em or en dashes');
  ok(tpl.recoveryEmail(0, 'https://x.co/?a="><script>', 's').html.includes('&#34;&#62;&#60;script&#62;'), 'link escaped in HTML');

  // runRecovery with stubs.
  const rows = new Set();
  const checkouts = {};
  const supabase = { createSupabaseAdminClient: () => ({ from: (table) => {
    let id = null, user = null;
    const q = {
      upsert(row) { rows.add(row.id); return Promise.resolve({ error: null }); },
      select() { return q; },
      eq(col, v) { if (col === 'id') id = v; if (col === 'user_id') user = v; return q; },
      limit: async () => (table === 'billing_checkouts' ? { data: checkouts[user] ? [checkouts[user]] : [], error: null } : { data: rows.has(id) ? [{ id }] : [], error: null }),
    };
    return q;
  } }) };
  const subs = new Set();
  const mod = load('src/lib/server/checkout-recovery.ts', {
    '@/lib/server/stripe': { stripe: () => { throw Error('use list stub'); } },
    '@/lib/server/usage': { subscriptionOf: async (u) => (subs.has(u) ? { plan: 'pro' } : null) },
    '@/lib/supabase/server': supabase, '@/lib/recovery-email': tpl, 'node:crypto': require('node:crypto'),
  }, { RESEND_API_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'service-key' });
  const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222', U3 = '33333333-3333-3333-3333-333333333333', U4 = '44444444-4444-4444-4444-444444444444', U5 = '55555555-5555-5555-5555-555555555555';
  const sec = (ms) => Math.floor(ms / 1000);
  const now = exp + 30 * 60_000;
  const sess = (id, user, status, created) => ({ id, client_reference_id: user, mode: 'subscription', status, payment_status: 'unpaid', created: sec(created), expires_at: sec(created + H), customer_details: { email: `${user.slice(0, 2)}@ex.com` } });
  const sessions = [
    sess('cs_a', U1, 'expired', exp - H),
    sess('cs_b_old', U2, 'expired', exp - H - 60_000), sess('cs_b_new', U2, 'open', exp),
    sess('cs_c', U3, 'expired', exp - H),
    sess('cs_d', U4, 'expired', exp - H),
    sess('cs_e', U5, 'expired', exp - H),
  ];
  checkouts[U5] = { session_id: 'cs_e_newer', created_at: new Date(exp).toISOString() };
  const list = () => (async function* () { yield* sessions; })();
  const sent = [];
  let fail = false;
  const fetcher = async (url, init) => { const b = JSON.parse(init.body); sent.push({ to: b.to[0], subject: b.subject, idem: init.headers['idempotency-key'], html: b.html }); return new Response('{}', { status: fail ? 500 : 200 }); };
  subs.add(U3);
  await mod.stopRecovery(U4);
  const n = await mod.runRecovery(now, fetcher, list);
  ok(n === 1 && sent.length === 1 && sent[0].to === '11@ex.com' && sent[0].subject === 'you were one click away', 'one email: U1 gets email 1');
  ok(!sent.some((s) => s.to === '22@ex.com') && !sent.some((s) => s.to === '55@ex.com'), 'came back (a newer checkout, in Stripe or just opened): nothing');
  ok(!sent.some((s) => s.to === '33@ex.com'), 'started a trial: nothing');
  ok(!sent.some((s) => s.to === '44@ex.com'), 'unsubscribed: nothing');
  ok(sent[0].html.includes('href="https://mavya.app/pricing"') && !sent[0].html.includes('checkout.stripe.com') && sent[0].idem === 'recovery:cs_a:0', "button opens Mavya's pricing (own checks), Resend idempotency per checkout and step");
  ok(await mod.runRecovery(now + 5 * 60_000, fetcher, list) === 0 && sent.length === 1, 'the next cron pass sends nothing again');
  ok(await mod.runRecovery(exp + 25 * H, fetcher, list) === 1 && sent[1].subject === 'i copied a 5M-view reel for my app', 'a day later: email 2');
  fail = true;
  ok(await mod.runRecovery(exp + 73 * H, fetcher, list) === 0 && !rows.has('recovery:cs_a:2'), 'Resend down: not recorded');
  fail = false;
  ok(await mod.runRecovery(exp + 74 * H, fetcher, list) === 1 && sent[sent.length - 1].subject === 'not ready for users yet?' && sent[sent.length - 1].idem === 'recovery:cs_a:2', 'next pass retries email 3 with the same idempotency key');

  const t = mod.stopToken(U1);
  ok(mod.validStop(U1, t) && !mod.validStop(U2, t) && !mod.validStop(U1, '0'.repeat(32)) && !mod.validStop('x', t), 'unsubscribe link is signed per user');
  ok(!/after_expiration/.test(fs.readFileSync('src/lib/server/billing-state.ts', 'utf8')), 'checkout creation unchanged (no Stripe recovery link: it would skip Mavya\'s checks)');
  const stop = fs.readFileSync('src/app/api/email/stop/route.ts', 'utf8');
  ok(/export async function GET[\s\S]*?<form method="post">/.test(stop) && /export async function POST[\s\S]*?stopRecovery\(user\)/.test(stop) && !/export async function GET[\s\S]*?stopRecovery\(user\)[\s\S]*?export async function POST/.test(stop), 'opening the link only shows a button; the POST unsubscribes (scanners cannot)');
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  ok(vercel.crons.some((c) => c.path === '/api/internal/recovery' && c.schedule === '*/15 * * * *') && /"\/api\/internal\/recovery", "\/api\/email\/stop"/.test(fs.readFileSync('src/lib/supabase/session.ts', 'utf8')), 'cron every 15 minutes; cron and unsubscribe reachable without sign-in');
});
