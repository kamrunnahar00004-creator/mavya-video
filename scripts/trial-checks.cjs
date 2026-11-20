/**
 * Free trial (founder 2026-11-21): 3 days, card required, 3 AI hooks, new accounts only. Unit and integration checks
 * with every Stripe and Supabase call stubbed (the real SQL is in trial-sql-checks.cjs):
 * - Checkout: an eligible account gets trial_period_days 3, card always collected, no card at the end cancels; an
 *   ineligible account (or a failed or missing eligibility check) gets a normal paid checkout.
 * - Plan change during a trial: switches at once with no charge and the same trial end; an active plan is unchanged.
 * - /api/usage: says trialEligible only for someone with no plan, and never asks for a plan holder.
 * - UI: "Start free trial" with "3 days free, then $29/mo" for new and signed-out viewers, "Choose" for anyone else;
 *   Billing shows the trial end and the first charge, or "You won't be charged" after cancelling; FAQ terms.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('./check-module.cjs');
let n = 0;
const ok = async (label, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAIL: ${label}`); throw e; } };
const plansLib = () => load('src/lib/plans.ts');

async function main() {
  const plans = plansLib();
  await ok('TRIAL constant is 3 days, 3 hooks', () => { assert.deepEqual({ ...plans.TRIAL }, { days: 3, hooks: 3 }); });
  await ok('trial terms read like the checkout', () => {
    const starter = plans.planById('starter'), studio = plans.planById('studio');
    assert.equal(plans.trialTerms(starter, 'monthly'), '3 days free, then $29/mo');
    assert.equal(plans.trialTerms(studio, 'annual'), '3 days free, then $990/yr');
  });

  // ---- billing-state: eligibility and Checkout params ----
  let rpcs = [], eligibleReply = { data: true }, pending = null;
  const session = { id: 'cs_fixture', status: 'open', url: 'https://checkout.fixture.invalid' };
  const db = { rpc: async (name, args) => {
    rpcs.push([name, args]);
    if (name === 'mavya_trial_eligible') return typeof eligibleReply === 'function' ? eligibleReply() : eligibleReply;
    if (name === 'mavya_checkout_prepare') { pending ??= { request_key: `key${rpcs.length}`, params: JSON.parse(JSON.stringify(args.p_params)), session_id: null, created_at: new Date().toISOString() }; return { data: pending }; }
    if (name === 'mavya_checkout_record') { pending.session_id = args.p_session; return { data: null }; }
    if (name === 'mavya_checkout_clear') { pending = null; return { data: null }; }
    throw new Error(`unexpected rpc ${name}`);
  } };
  let created = [], expired = [];
  const stripeStub = { subscriptions: { retrieve: async () => ({ status: 'canceled' }) }, checkout: { sessions: { create: async (params) => { created.push(params); return { ...session, id: `cs_${created.length}` }; }, retrieve: async (id) => ({ ...session, id }), expire: async (id) => { expired.push(id); } } } };
  const state = load('src/lib/server/billing-state.ts', {
    '@/lib/plans': plans,
    '@/lib/supabase/server': { createSupabaseAdminClient: () => db },
    '@/lib/server/stripe': { priceFor: (p, c) => `price_${p}_${c}`, stripe: () => stripeStub, subscriptionRow: () => ({}) },
  });
  await ok('eligible account: rpc true is a trial', async () => { eligibleReply = { data: true }; assert.equal(await state.trialEligible('u1'), true); });
  await ok('not eligible: rpc false is no trial', async () => { eligibleReply = { data: false }; assert.equal(await state.trialEligible('u1'), false); });
  await ok('migration not run yet (function missing): no trial', async () => {
    eligibleReply = { error: Object.assign(new Error('Could not find the function'), { code: 'PGRST202' }) };
    assert.equal(await state.trialEligible('u1'), false);
    eligibleReply = { error: Object.assign(new Error('function does not exist'), { code: '42883' }) };
    assert.equal(await state.trialEligible('u1'), false);
    eligibleReply = { data: null };
    assert.equal(await state.trialEligible('u1'), false);
  });
  await ok('any other DB failure is an error, never a silent paid checkout', async () => {
    eligibleReply = { error: Object.assign(new Error('timeout'), { code: '57014' }) };
    await assert.rejects(state.trialEligible('u1'), /timeout/);
    eligibleReply = () => { throw new Error('network'); };
    await assert.rejects(state.trialEligible('u1'), /network/);
  });
  const checkout = async (trial) => { created = []; pending = null; const url = await state.pendingCheckout({ id: 'u1', email: 'a@fixture.invalid' }, 'token', null, 'starter', 'monthly', 'https://mavya.test', trial); return { url, params: created[0] }; };
  await ok('trial checkout: 3 days, card always, cancel without a card', async () => {
    const { url, params } = await checkout(true);
    assert.equal(url, session.url);
    assert.equal(params.mode, 'subscription');
    assert.equal(params.payment_method_collection, 'always');
    assert.equal(params.subscription_data.trial_period_days, 3);
    assert.equal(params.subscription_data.trial_settings.end_behavior.missing_payment_method, 'cancel');
    assert.equal(params.subscription_data.metadata.user_id, 'u1');
    assert.equal(params.line_items[0].price, 'price_starter_monthly');
  });
  await ok('paid checkout: no trial fields, card still collected', async () => {
    const { params } = await checkout(false);
    assert.equal(params.subscription_data.trial_period_days, undefined);
    assert.equal(params.subscription_data.trial_settings, undefined);
    assert.equal(params.payment_method_collection, 'always');
  });
  await ok('an open paid checkout is replaced when the trial applies', async () => {
    created = []; expired = []; pending = null;
    await state.pendingCheckout({ id: 'u1' }, 'token', null, 'starter', 'monthly', 'https://mavya.test', false);
    const paidSession = pending.session_id;
    const url = await state.pendingCheckout({ id: 'u1' }, 'token', null, 'starter', 'monthly', 'https://mavya.test', true);
    assert.equal(url, session.url);
    assert.deepEqual(expired, [paidSession]);
    assert.equal(created.length, 2);
    assert.equal(created[1].subscription_data.trial_period_days, 3);
  });
  await ok('an open paid checkout for another plan is replaced too, not blocking the trial', async () => {
    created = []; expired = []; pending = null;
    await state.pendingCheckout({ id: 'u1' }, 'token', null, 'starter', 'monthly', 'https://mavya.test', false);
    const paidSession = pending.session_id;
    const url = await state.pendingCheckout({ id: 'u1' }, 'token', null, 'pro', 'monthly', 'https://mavya.test', true);
    assert.equal(url, session.url); assert.deepEqual(expired, [paidSession]);
    assert.equal(created[1].line_items[0].price, 'price_pro_monthly'); assert.equal(created[1].subscription_data.trial_period_days, 3);
  });
  await ok('same trial terms, other plan: still asks to finish the open checkout', async () => {
    created = []; expired = []; pending = null;
    await state.pendingCheckout({ id: 'u1' }, 'token', null, 'starter', 'monthly', 'https://mavya.test', true);
    await assert.rejects(state.pendingCheckout({ id: 'u1' }, 'token', null, 'pro', 'monthly', 'https://mavya.test', true), /Finish your open checkout/);
    assert.deepEqual(expired, []); pending = null;
  });
  await ok('an open trial checkout is reused as is', async () => {
    created = []; expired = []; pending = null;
    await state.pendingCheckout({ id: 'u1' }, 'token', null, 'pro', 'monthly', 'https://mavya.test', true);
    await state.pendingCheckout({ id: 'u1' }, 'token', null, 'pro', 'monthly', 'https://mavya.test', true);
    assert.equal(created.length, 1); assert.deepEqual(expired, []);
  });
  await ok('default (no flag) is a paid checkout', async () => { pending = null;
    created = []; pending = null;
    await state.pendingCheckout({ id: 'u1' }, 'token', null, 'pro', 'annual', 'https://mavya.test');
    assert.equal(created[0].subscription_data.trial_period_days, undefined);
  });

  // ---- /api/billing checkout passes eligibility ----
  let trialAnswer = true, passed = [];
  const route = load('src/app/api/billing/route.ts', {
    'next/server': { connection: async () => {} },
    '@/lib/plans': plans,
    '@/lib/server/stripe': { planOfPrice: () => null, stripe: () => ({}), stripeEnabled: () => true },
    '@/lib/server/billing-change': { changeSubscription() { throw Error('unexpected'); }, clearPendingChange() { throw Error('unexpected'); } },
    '@/lib/supabase/server': { getSessionUser: async () => ({ id: 'u1', email: 'a@fixture.invalid' }) },
    '@/lib/server/billing-state': {
      applyBillingAction: async () => {}, BillingBusy: class extends Error {}, billingRow: async () => null,
      withBillingLock: async (_u, work) => work('token'),
      trialEligible: async (u) => { assert.equal(u, 'u1'); return trialAnswer; },
      pendingCheckout: async (...args) => { passed = args; return 'https://checkout.fixture.invalid'; },
    },
  }, { STRIPE_SECRET_KEY: 'sk_test' });
  const post = (body) => route.POST(new Request('https://mavya.test/api/billing', { method: 'POST', body: JSON.stringify(body) }));
  await ok('checkout route: eligible account gets the trial flag', async () => {
    trialAnswer = true; const r = await post({ action: 'checkout', plan: 'starter', cycle: 'monthly' });
    assert.equal(r.status, 200); assert.equal(passed[6], true); assert.equal(passed[3], 'starter');
  });
  await ok('checkout route: ineligible account does not', async () => {
    trialAnswer = false; await post({ action: 'checkout', plan: 'pro', cycle: 'annual' });
    assert.equal(passed[6], false); assert.equal(passed[4], 'annual');
  });

  let subStatus = 'active', changed = 0;
  const changeRoute = load('src/app/api/billing/route.ts', {
    'next/server': { connection: async () => {} },
    '@/lib/plans': plans,
    '@/lib/server/stripe': { planOfPrice: () => null, stripe: () => ({ subscriptions: { retrieve: async () => ({ id: 'sub', status: subStatus }) } }), stripeEnabled: () => true },
    '@/lib/server/billing-change': { changeSubscription: async (sub) => { changed++; return { sub, scheduled: false }; }, clearPendingChange: async () => {} },
    '@/lib/supabase/server': { getSessionUser: async () => ({ id: 'u1' }) },
    '@/lib/server/billing-state': {
      applyBillingAction: async () => {}, BillingBusy: class extends Error {}, withBillingLock: async (_u, work) => work('token'),
      billingRow: async () => ({ plan: 'starter', status: subStatus, stripe_subscription_id: 'sub' }), trialEligible: async () => false, pendingCheckout: async () => '',
    },
  }, { STRIPE_SECRET_KEY: 'sk_test' });
  const changePost = (body) => changeRoute.POST(new Request('https://mavya.test/api/billing', { method: 'POST', body: JSON.stringify(body) }));
  await ok('a trial confirmation after the trial converted is refused, nothing charged', async () => {
    subStatus = 'active'; changed = 0;
    const r = await changePost({ action: 'change', plan: 'pro', cycle: 'monthly', expect: 'trialing' });
    assert.equal(r.status, 409); assert.match((await r.json()).error, /trial has ended/); assert.equal(changed, 0);
  });
  await ok('a trial confirmation during the trial goes through', async () => {
    subStatus = 'trialing'; changed = 0;
    const r = await changePost({ action: 'change', plan: 'pro', cycle: 'monthly', expect: 'trialing' });
    assert.equal(r.status, 200); assert.equal(changed, 1);
  });
  await ok('a normal change on an active plan is unaffected', async () => {
    subStatus = 'active'; changed = 0;
    const r = await changePost({ action: 'change', plan: 'pro', cycle: 'monthly' });
    assert.equal(r.status, 200); assert.equal(changed, 1);
  });

  // ---- plan change during a trial ----
  const trialEnd = Math.floor(Date.now() / 1000) + 2 * 86400;
  let calls = [], current;
  const change = load('src/lib/server/billing-change.ts', {
    'node:crypto': require('node:crypto'),
    '@/lib/plans': { planById: (id) => ({ hooks: { starter: 20, pro: 60, studio: 150 }[id] }) },
    '@/lib/server/stripe': {
      planOfPrice: (id) => ({ plan: id.split('-')[0], cycle: id.split('-')[1] }), priceFor: (p, c) => `${p}-${c}`,
      subscriptionPeriod: () => ({ start: new Date().toISOString(), end: new Date(trialEnd * 1000).toISOString() }),
      stripe: () => ({
        subscriptions: { retrieve: async () => current, update: async (id, params, options) => { calls.push(['update', params, options]); current = { ...current, items: { data: [{ ...current.items.data[0], price: { id: params.items[0].price } }] } }; return current; } },
        subscriptionSchedules: { release: async () => { calls.push(['release']); }, retrieve: async () => { throw Error('no schedule in a trial'); }, create: async () => { throw Error('no schedule in a trial'); } },
      }),
    },
  });
  const trialing = (extra = {}) => ({ id: 'sub', status: 'trialing', trial_end: trialEnd, collection_method: 'charge_automatically', items: { data: [{ id: 'item', quantity: 1, price: { id: 'starter-monthly' } }] }, ...extra });
  for (const [plan, cycle, what] of [['pro', 'monthly', 'upgrade'], ['studio', 'annual', 'upgrade and yearly'], ['starter', 'annual', 'cycle switch']]) {
    await ok(`trial ${what}: switches now, no charge, same trial end`, async () => {
      current = trialing(); calls = [];
      const r = await change.changeSubscription(current, plan, cycle, 'owner');
      assert.equal(r.scheduled, false);
      const u = calls.find((c) => c[0] === 'update');
      assert.equal(u[1].items[0].price, `${plan}-${cycle}`);
      assert.equal(u[1].proration_behavior, 'none');
      assert.equal(u[1].trial_end, trialEnd);
      assert.equal(u[1].payment_behavior, undefined, 'nothing is collected');
      assert.equal(u[2], undefined, 'no idempotency key: a repeat switch is never a stale replay');
      assert.equal('cancel_at_period_end' in u[1], false, 'a cancellation is left alone');
      assert.equal('cancel_at' in u[1], false);
    });
  }
  await ok('trial downgrade also switches now (no schedule)', async () => {
    current = trialing({ items: { data: [{ id: 'item', quantity: 1, price: { id: 'studio-monthly' } }] } }); calls = [];
    const r = await change.changeSubscription(current, 'starter', 'monthly', 'owner');
    assert.equal(r.scheduled, false); assert.equal(calls.find((c) => c[0] === 'update')[1].items[0].price, 'starter-monthly');
  });
  await ok('switching A to B, back to A, then B again lands on B', async () => {
    current = trialing(); calls = [];
    for (const plan of ['pro', 'starter', 'pro']) await change.changeSubscription(current, plan, 'monthly', 'owner');
    assert.equal(current.items.data[0].price.id, 'pro-monthly');
  });
  await ok('a cancelled trial stays cancelled after a plan switch', async () => {
    current = trialing({ cancel_at_period_end: true }); calls = [];
    await change.changeSubscription(current, 'pro', 'monthly', 'owner');
    const u = calls.find((c) => c[0] === 'update')[1];
    assert.equal(u.cancel_at_period_end, undefined); assert.equal(u.cancel_at, undefined);
  });
  await ok('a pending schedule is released before the trial change', async () => {
    current = trialing({ schedule: 'sched' }); calls = [];
    await change.changeSubscription(current, 'pro', 'monthly', 'owner');
    assert.equal(calls[0][0], 'release'); assert.equal(calls[1][0], 'update');
  });
  await ok('a trial without an end date is refused, nothing changed', async () => {
    current = trialing({ trial_end: null }); calls = [];
    await assert.rejects(change.changeSubscription(current, 'pro', 'monthly', 'owner'), /Trial period needs recovery/);
    assert.equal(calls.length, 0);
  });
  await ok('an active plan still upgrades with an immediate charge', async () => {
    current = trialing({ status: 'active', trial_end: null }); calls = [];
    await change.changeSubscription(current, 'pro', 'monthly', 'owner');
    const u = calls.find((c) => c[0] === 'update');
    assert.equal(u[1].proration_behavior, 'always_invoice'); assert.equal(u[1].trial_end, undefined);
  });
  await ok('past_due still needs support', async () => {
    current = trialing({ status: 'past_due' });
    await assert.rejects(change.changeSubscription(current, 'pro', 'monthly', 'owner'), /needs support/);
  });

  // ---- /api/usage ----
  let a = { plan: null, admin: false, used: 0, limit: 0, resetsAt: null }, row = null, asked = 0, answer = true;
  const usage = load('src/app/api/usage/route.ts', {
    '@/lib/server/read-timing': { readResponse: (work) => work() },
    'next/server': { connection: async () => {} },
    '@/lib/server/billing-state': { billingRow: async () => row, trialEligible: async () => { asked++; return answer; } },
    '@/lib/server/usage': { allowance: async () => a, subscriptionOf: async () => null },
    '@/lib/server/who': { currentUser: async () => 'u1', signInFirst: () => Response.json({}, { status: 401 }) },
  });
  const usageJson = async () => (await usage.GET()).json();
  await ok('usage: a new account is trial eligible', async () => { asked = 0; answer = true; assert.equal((await usageJson()).trialEligible, true); assert.equal(asked, 1); });
  await ok('usage: an account that had one is not', async () => { answer = false; assert.equal((await usageJson()).trialEligible, false); });
  await ok('usage: a plan holder is never asked', async () => { asked = 0; a = { ...a, plan: 'starter', limit: 3, trial: true }; const j = await usageJson(); assert.equal(j.trialEligible, false); assert.equal(j.trial, true); assert.equal(asked, 0); });
  await ok('usage: admin is never asked', async () => { asked = 0; a = { plan: null, admin: true, used: 0, limit: null, resetsAt: null }; assert.equal((await usageJson()).trialEligible, false); assert.equal(asked, 0); });
  await ok('usage: an eligibility error just hides the trial', async () => {
    const failing = load('src/app/api/usage/route.ts', {
      '@/lib/server/read-timing': { readResponse: (work) => work() }, 'next/server': { connection: async () => {} },
      '@/lib/server/billing-state': { billingRow: async () => null, trialEligible: async () => { throw new Error('db'); } },
      '@/lib/server/usage': { allowance: async () => ({ plan: null, admin: false, used: 0, limit: 0, resetsAt: null }), subscriptionOf: async () => null },
      '@/lib/server/who': { currentUser: async () => 'u1', signInFirst: () => Response.json({}, { status: 401 }) },
    });
    const r = await failing.GET(); assert.equal(r.status, 200); assert.equal((await r.json()).trialEligible, false);
  });
  await ok('usage: a stored subscription id skips the check', async () => { asked = 0; a = { plan: null, admin: false, used: 0, limit: 0, resetsAt: null }; row = { stripe_subscription_id: 'sub_old', status: 'canceled' }; assert.equal((await usageJson()).trialEligible, false); assert.equal(asked, 0); row = null; });

  // ---- UI ----
  const icon = () => null;
  const ui = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), '@/components/pending-link': { __esModule: true, default: (p) => React.createElement('a', { href: p.href }, p.children) }, 'lucide-react': new Proxy({}, { get: () => icon }), '@/components/contact-dialog': { ContactDialog: () => null }, '@/lib/plans': plans };
  const pricing = load('src/components/pricing-page.tsx', { ...ui, '@/components/marketing-chrome': { MarketingFooter: () => null, MarketingHeader: () => null, MavyaMark: () => null } }, {}, { fetch: async () => new Response('{}') });
  const button = (viewer, cycle = 'monthly', id = 'starter') => renderToStaticMarkup(React.createElement(pricing.PlanButton, { plan: plans.planById(id), cycle, viewer }));
  await ok('pricing: signed out sees the trial and its terms', () => { const h = button({ kind: 'out' }); assert.ok(h.includes('Start free trial')); assert.ok(h.includes('3 days free, then $29/mo')); });
  await ok('pricing: eligible signed-in sees the trial', () => { const h = button({ kind: 'none', trial: true }, 'annual', 'pro'); assert.ok(h.includes('Start free trial')); assert.ok(h.includes('3 days free, then $590/yr')); });
  await ok('pricing: ineligible signed-in sees a normal plan button', () => { const h = button({ kind: 'none', trial: false }); assert.ok(h.includes('Choose Starter')); assert.ok(!h.includes('free')); });
  await ok('pricing: a plan holder is not offered a trial', () => { const h = button({ kind: 'plan', plan: 'starter' }, 'monthly', 'pro'); assert.ok(h.includes('Switch to Pro')); assert.ok(!h.includes('free')); });
  await ok('pricing: FAQ states the trial terms', () => {
    const page = renderToStaticMarkup(React.createElement(pricing.PricingPage));
    assert.ok(page.includes('Is there a free trial?'));
    assert.ok(page.includes('3 days free with 3 AI hooks on any plan'));
    assert.ok(page.includes('you pay nothing'));
    assert.ok(!page.includes('Is there a free plan?'));
  });

  const shell = (usageValue, billingValue) => ({ BTN_OUTLINE: '', BTN_DANGER: '', SettingsPage: (p) => React.createElement('div', null, p.children), billingAction: async () => null, formatDate: (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }), useToast: () => [null, () => {}], useAccount: () => ({ usage: usageValue, billing: billingValue, plan: billingValue?.subscription ? plans.planById(billingValue.subscription.plan) : null, loaded: true, error: false, reload() {} }) });
  const plansView = (usageValue) => {
    const cards = load('src/components/plan-cards.tsx', ui);
    const m = load('src/components/plans-view.tsx', { ...ui, 'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) }, '@/components/plan-cards': cards, '@/components/settings-shell': shell(usageValue, { subscription: null }) });
    return renderToStaticMarkup(React.createElement(m.PlansView));
  };
  await ok('Plans: eligible account sees Start free trial on every plan with terms', () => {
    const h = plansView({ plan: null, trialEligible: true });
    assert.equal((h.match(/Start free trial/g) || []).length, 3);
    for (const t of ['3 days free, then $29/mo', '3 days free, then $59/mo', '3 days free, then $99/mo']) assert.ok(h.includes(t), t);
  });
  await ok('Plans: ineligible account sees Choose and no terms', () => {
    const h = plansView({ plan: null, trialEligible: false });
    assert.ok(h.includes('Choose Starter')); assert.ok(!h.includes('days free'));
  });

  await ok('Plans: trial switches say no charge and send the trial expectation', () => {
    const src = require('node:fs').readFileSync('src/components/plans-view.tsx', 'utf8');
    assert.ok(src.includes('Switches now. Nothing is charged until your trial ends.'));
    assert.ok(src.includes('...(current && trialing ? { expect: "trialing" } : {})'));
    assert.ok(src.includes('if (current) await reload();'), 'a refused change reloads the plan');
  });

  const end = '2026-11-24T10:00:00.000Z';
  const billingView = (sub) => {
    const m = load('src/components/billing-view.tsx', { ...ui, 'next/navigation': { useSearchParams: () => new URLSearchParams() }, '@/components/settings-shell': shell({ plan: sub.plan }, { enabled: true, subscription: sub, card: null, invoices: [] }) });
    return renderToStaticMarkup(React.createElement(m.BillingView));
  };
  await ok('Billing: a trial shows its end and the first charge', () => {
    const h = billingView({ plan: 'starter', cycle: 'monthly', status: 'trialing', periodEnd: end, cancelAtPeriodEnd: false });
    assert.ok(h.includes('Free trial')); assert.ok(h.includes('Trial ends on November 24, 2026, then $29 a month')); assert.ok(!h.includes('Renews on'));
  });
  await ok('Billing: a cancelled trial says no charge', () => {
    const h = billingView({ plan: 'pro', cycle: 'annual', status: 'trialing', periodEnd: end, cancelAtPeriodEnd: true });
    assert.ok(h.includes("Trial ends on November 24, 2026. You won&#x27;t be charged."));
  });
  await ok('Billing: an active plan is unchanged', () => {
    const h = billingView({ plan: 'starter', cycle: 'monthly', status: 'active', periodEnd: end, cancelAtPeriodEnd: false });
    assert.ok(h.includes('Active')); assert.ok(h.includes('$29 a month')); assert.ok(h.includes('Renews on November 24, 2026')); assert.ok(!h.includes('Free trial'));
  });

  console.log(`trial-checks: ${n} checks pass`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
