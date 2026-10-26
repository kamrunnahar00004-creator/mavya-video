# Codex verify + fix request, 2026-10-26

From Claude, for Codex. Scope: everything that changed or was learned on 2026-10-26, plus the
known weak spots below. Verify each item against the code, fix what is really broken, add tests,
and write your results to `docs/CODEX_VERIFY_REPORT_2026-10-26.md` (one section per item:
verdict, evidence, fix commit). Do not "fix" things that are founder decisions (list at the end).

Commits to review: `09f2d96` (checkout return), `f4ee339` (forgot password). Context commits:
`cd655fe`, `79dad9b`, `b0dc253`.

## What happened today (facts, verified live)

1. **All Stripe webhooks failed for about a day with `400 invalid signature`.** Cause: the
   `STRIPE_WEBHOOK_SECRET` in Vercel did not match the endpoint secret. The founder re-entered it
   and redeployed; a signed test event then returned 200 and the stuck events were resent
   (`result: "applied"`). No code bug, but nothing told us it was broken: a paying customer would
   have been stuck on "Confirming your payment..." with no alert anywhere.
2. **Paid users now enter the app at once** (`09f2d96`). Checkout `success_url` is
   `/checkout/return?session_id={CHECKOUT_SESSION_ID}`; `cancel_url` is `/pricing`. Live test
   (real $29 card payment, refunded): the subscription row was written about 4 seconds after the
   subscription was created, before the webhook, and the founder landed in /studio.
3. **Forgot password shipped** (`f4ee339`). Supabase now sends auth email through Resend SMTP
   from `no-reply@mavya.app` (domain verified, DNS at Namecheap). The Reset Password template
   link is `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`. Live test:
   email arrived in the inbox, link opened "Set a new password", save landed in /studio.
   A bad token goes to `/reset-password?expired=1` (checked with curl).
4. **Test data cleaned up.** Both test subscriptions cancelled, the $29 charge fully refunded,
   and an old Etsy-era $0 subscription (`sub_1U8HXXDJO1RckprY9BlQlUf1`, founder's own, no
   `user_id` metadata) was cancelled.

## Items to verify and fix

### B1. Checkout return route (`src/app/checkout/return/route.ts`), verify correctness
- Ordering: it calls `mavya_billing_event` with `p_created = session.created` (the Checkout
  Session creation time, before payment) and `p_event = checkout-return:<session id>`. Confirm a
  later webhook (`customer.subscription.*`, `invoice.paid`) always wins over this row, and that
  this row can never overwrite a newer state (e.g. the user cancels within seconds, or an
  upgrade webhook lands first). Confirm a replay of the same URL is a no-op.
- Ownership: it requires `client_reference_id === user.id`, `status === "complete"`, a
  subscription id, and `payment_status` in `paid | no_payment_required`. It checks
  `metadata.user_id` only when present. Confirm nobody can attach someone else's subscription
  by visiting the URL with another session id, and that `billing_subscription_ids` binding is
  written the same way the webhook path writes it.
- The user's account was created by Google sign-in for an email whose old account was deleted
  (`account_deletions`). Confirm the return route behaves like the webhook for accounts with a
  deletion record (the webhook routes those to `mavya_deletion_event`; the return route does
  not check `account_deletions` at all).
- `result === "conflict"` and every exception fall back to `/settings/billing?paid=1`. Confirm
  that page still waits for the webhook and then opens /studio.
- **Missing tests.** Add the return route to `scripts/billing-checks.cjs` (or a new script):
  signed out, bad session id, someone else's session, incomplete session, unpaid, success,
  replay, conflict, Stripe error.

### B2. Webhook failure is silent (the 2026-10-26 incident)
- A wrong secret returns 400 forever with no signal to us. Add a cheap guard: for example, log a
  distinct error line on signature failure (already logged? it is not, the catch is silent) and,
  if practical, count failures somewhere the founder can see (Vercel log alert or a row).
- Add `STRIPE_WEBHOOK_SECRET` shape validation where config is checked (trimmed, starts with
  `whsec_`), without making the whole app 503 if billing is misconfigured.

### B3. Unresolved subscription owner retries forever
- `src/app/api/stripe/webhook/route.ts` throws `Unresolved subscription owner` and returns 500,
  so Stripe retries for days. A subscription that no account owns (like the old Etsy-era one)
  will never resolve. Stripe emails and can disable an endpoint that keeps failing, which would
  break billing for real customers.
- Fix: once the owner is definitively unknown (all lookups succeeded and found nothing), record
  it (e.g. `billing_conflicts` or a log) and return 200. Keep 500 for transient failures
  (database or Stripe errors), so those still retry.

### B4. Forgot password (`src/components/auth-modal.tsx`, `src/app/auth/callback/route.ts`,
`src/app/reset-password/page.tsx`, `src/components/reset-password-form.tsx`)
- Callback: `token_hash` goes through `verifyOtp({ type: "recovery" })`; `code` goes through
  `exchangeCodeForSession`. A reset (`next === "/reset-password"` or `type=recovery`) redirects
  straight to `/reset-password`, never through `/auth/continue` (which would send unpaid users to
  /pricing). Failure goes to `/reset-password?expired=1`. Confirm Google sign-in is unchanged.
- Enumeration: the modal shows the same "If <email> has an account..." message whatever the
  email; only a 429 shows a different message. Confirm.
- `/reset-password` is outside the proxy matcher, so the proxy does not refresh its session.
  Confirm the page works and cannot be used to reach app pages without the paid gate (after
  saving it goes to `/auth/continue?next=/studio`).
- Any signed-in session can open `/reset-password` and set a new password without the old one.
  That is how Supabase recovery works; decide whether Supabase "Secure password change" (or a
  recent-login check) should be on, and report, but do not block the recovery flow.
- Minor: switching the modal to Forgot mode does not focus the new email input.
- **Missing tests.** Extend `scripts/auth-next-checks.cjs` and `scripts/verify-auth-flow.cjs`:
  token_hash success and failure, code with `next=/reset-password`, Google code unchanged,
  modal forgot mode (send, 429, sent state, back to login), reset form (too short, mismatch,
  `same_password`, success navigation, expired state).

### B5. Contact form sender
- `src/app/api/contact/route.ts` defaults `from` to `onboarding@resend.dev`, which Resend only
  delivers to the account owner. It works today only because the recipient is the founder. Now
  that `mavya.app` is verified, default to `Mavya <no-reply@mavya.app>` (keep `CONTACT_FROM`
  override and `reply_to` = the sender's email).

### B6. General sweep
- Run every `scripts/*-checks.cjs` and `scripts/verify-*.cjs`, `npx tsc --noEmit`, eslint and a
  production build. Report anything failing, with output.
- Look for anything else broken in billing, auth, the paid gate (`src/lib/supabase/session.ts`),
  generation jobs and export. Report each finding with file:line and a concrete failure
  scenario; fix only what you can show is broken.

## Rules (founder decisions, do not change)

- Prices fixed: $29 / $59 / $99, 20 / 60 / 150 hooks. Never change.
- Auth: no email confirmation ever; Google creates the account if missing; email login with an
  unknown address shows an error; unpaid accounts only see /pricing (Settings stays open);
  past_due goes to Billing; admins by `ADMIN_USER_IDS`, never by email.
- Hook generation stays Kling via fal. Do not run real fal generations, real Stripe charges or
  anything else that spends money. Use stubs and fixtures.
- No ffmpeg post-processing of generated hooks. No Glass text styles. TikTok Sans default.
- UI copy: no em dashes, no filler or helper lines.
- Never commit `.env*`. Commit as `kamrunnahar00004-creator` (repo-local config), or Vercel
  blocks the deploy.
