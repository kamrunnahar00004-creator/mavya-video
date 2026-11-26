// Welcome email (founder 2026-11-26, for paid ads): phone signups get the link to open Mavya on a computer. Checks the
// name, the copy (no em or en dashes), escaping, the once-per-account Idempotency-Key, and that a failure never throws.
// Offline: fetch is a stub.
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 16;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.equal(a, b, msg); };
const w = load('src/lib/server/welcome-email.ts');

finish('welcome-email-checks', EXPECTED, () => checks, async () => {
  eq(w.firstName({ full_name: 'Maya Grace' }), 'Maya', 'Google full name: first word');
  eq(w.firstName({ given_name: 'Ana' }), 'Ana', 'given name used');
  eq(w.firstName({}), '', 'no name: empty');
  eq(w.firstName({ name: '<script>' }), '', 'odd name dropped');

  const m = w.welcomeEmail('Maya');
  ok(m.text.startsWith('Hey Maya,') && w.welcomeEmail('').text.startsWith('Hey there,'), 'greets by name, or Hey there');
  ok(m.text.includes(w.WELCOME_LINK) && m.html.includes(`href="${w.WELCOME_LINK}"`) && w.WELCOME_LINK === 'https://mavya.app/studio', 'link to the app in text and button');
  ok(m.subject === 'Welcome to Mavya 🎬' && /laptop or desktop/.test(m.text) && /Create your first reel/.test(m.html), "founder's copy, with the open-on-a-computer line");
  ok(!/[\u2013\u2014]/.test(m.subject + m.text + m.html), 'no em or en dashes');
  ok(w.welcomeEmail('O\'Neil').html.includes('Hey O&#39;Neil,'), 'name escaped in HTML');

  const user = { id: 'u1', email: 'maya@example.com', user_metadata: { full_name: 'Maya Grace' } };
  const sent = [];
  const fetcher = async (url, init) => { sent.push({ url, init }); return new Response('{}', { status: 200 }); };
  ok(await w.sendWelcome(user, { RESEND_API_KEY: 'k' }, fetcher), 'sent');
  const h = sent[0].init.headers, body = JSON.parse(sent[0].init.body);
  ok(sent[0].url === 'https://api.resend.com/emails' && h['idempotency-key'] === 'welcome/u1', 'one email per account (Idempotency-Key)');
  ok(body.to[0] === 'maya@example.com' && body.reply_to === 'hello@mavya.app' && /hello@mavya\.app/.test(body.from), 'to the user, from and reply to hello@mavya.app');
  ok(!(await w.sendWelcome(user, {}, fetcher)) && !(await w.sendWelcome({ id: 'u2', email: 'bad' }, { RESEND_API_KEY: 'k' }, fetcher)) && sent.length === 1, 'no key or bad email: nothing sent');
  let tries = 0;
  ok(!(await w.sendWelcome(user, { RESEND_API_KEY: 'k' }, async () => { tries++; throw new Error('down'); }, 1)) && tries === 2, 'Resend unreachable: one retry, then false, never throws');
  tries = 0;
  ok(await w.sendWelcome(user, { RESEND_API_KEY: 'k' }, async () => (++tries === 1 ? new Response('x', { status: 503 }) : new Response('{}', { status: 200 })), 1) && tries === 2, '5xx then ok: sent on the retry');
  tries = 0;
  ok(!(await w.sendWelcome(user, { RESEND_API_KEY: 'k' }, async () => { tries++; return new Response('x', { status: 422 }); }, 1)) && tries === 1, 'a rejected email (4xx): no retry');
});
