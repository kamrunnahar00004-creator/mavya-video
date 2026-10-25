# Auth flow verification, 2026-10-25

Branch: `codex/verify-auth-2026-10-25`, from main `734057c`. Reviewed the requested auth/payment-gate changes through `c4f4f3c`. Local commits only; no push, merge, production writes, real account creation, emails, paid requests or live Stripe calls. No scraping or audio playback. No price, plan-limit, model, prompt or UI-style edits. Founder .data and .env files were not changed.

The ordinary auth/gate flows pass the stub and SQL checks after the fixes below. **Admin authorization is not cleared for public unconfirmed signup.** Its email-only trust rule has a privilege-escalation path when an admin-listed address is available for registration. That requires a trusted admin-identity decision, not a confirmation-email flow.

## 1. Ranked findings

### Critical

**A0. Unconfirmed public email signup and email-only admin privileges are incompatible. Open.**

- Evidence: `src/lib/supabase/session.ts:77`, `src/lib/server/usage.ts:11`, `src/lib/server/generation-jobs.ts` admin exemption, and the immediate signUp path in `src/components/auth-modal.tsx`.
- Breakage: a valid Supabase token proves that Supabase issued a session, not that a user owns the address they typed when email confirmation is disabled. Both admin paths compare that address with ADMIN_EMAILS. Someone who registers an unused admin-listed email address can therefore receive app/API bypass and unlimited generation allowance without owning that mailbox.
- Concrete reproduction: in the offline fixture, getSessionUser returns a newly registered user with an admin-listed email and no ownership evidence; actual adminUser returns true. A matching claim in the actual proxy helper bypasses the allowance fetch entirely. With confirmation disabled, public signup is the route to obtaining such a genuine session. No token forgery is needed. No real admin address or production account was tested.
- Exploit prerequisite: the target admin-listed email must be registerable. Existing occupied accounts reject ordinary duplicate signup. Whether every production admin address is already occupied, and how future admin address changes are provisioned, were not inspected. This is a confirmed authorization-design defect, not a claim that a production account was taken over.
- Smallest robust resolution: bind admin authorization to pre-provisioned immutable user IDs or server-controlled role metadata, consistently in proxy and server helpers. Alternatively, enforce a trusted signup restriction for reserved admin identities. Keep ordinary email signup immediate; do not turn confirmation back on.
- Why not patched: the request explicitly defines admins using ADMIN_EMAILS. Silently replacing that contract without the founder's trusted IDs or provisioning policy can lock out legitimate admins or leave a second bypass path. No guessed IDs, email-verification requirement or partial client-side signup block was introduced. An email_confirmed_at check alone is also insufficient when signup is auto-confirmed by configuration.

### High

No additional confirmed High finding in this auth delta. A0 prevents a blanket security approval even though functional gate tests pass.

### Medium

**A1. Signed-in visitors still received the auth popup; the signup fallback contradicted the no-confirmation rule. Fixed, `bc153f5`.**

- Evidence: `src/components/auth-modal.tsx:26`, its signUp/session branch, and `src/lib/auth-error.ts`.
- Before: AuthModalHost rendered solely from query parameters, so existing users clicking the marketing header saw signup/login again. A signup returning no session displayed a confirmation-email instruction despite the founder's rule.
- Reproduce: return an authenticated user while opening `?auth=signup`; the old host still rendered the signup form. Return a signup response without a session; the old notice instructed email confirmation.
- Fix: check browser user state before displaying the popup. Existing users load `/auth/continue` with safe next; signed-out users get the form. Successful email signup navigates immediately. A missing session is an error, not a confirmation flow, and signup no longer supplies emailRedirectTo.
- Error mapping now prefers Supabase codes user_already_exists/email_exists and invalid_credentials, scoped to signup/login respectively, with exact legacy wording fallback. Other errors remain visible rather than being matched by broad text fragments. email_exists compatibility and the intentional full-load lint annotation were completed in `010bde0`.
- Checks execute the actual host/modal with hook and provider stubs: signup immediate session, login, existing email switching to login, invalid credentials, rate-limit error preserved, missing session, both Google tabs and authenticated popup suppression.

**A2. `/login` skipped the paid check and API denials lost refreshed cookies. Fixed, `3ff6bdf`.**

- Evidence: `src/lib/supabase/session.ts:42` and `:64`.
- Before: signed-in `/login` redirected to studio before consulting allowance, relying on a second request to apply the gate. Signed-out `/login` opened login instead of the requested signup entry. API 401/402 responses were fresh Response objects without the session cookies prepared by Supabase refresh.
- Reproduce: request `/login` with no plan; old response points to studio. Have getClaims refresh its cookie, then deny `/api/uploads`; old response omits the replacement cookie. Losing a rotated cookie can break subsequent requests.
- Fix: `/login` follows the same signed-out entry and signed-in paid check. API denial responses preserve the same refreshed cookies as page redirects. A signed-in paid/admin login still redirects to studio.
- Checks cover all requested app roots and nested pages, RSC/prefetch headers, login, settings, paid API 401/402/200 cases, private media playback exemption and refreshed denial cookies.

**A3. Past-due users were invited into Checkout that billing correctly refuses. Fixed, `a1faf62`.**

- Evidence: `src/app/auth/continue/route.ts:19`, `src/components/pricing-page.tsx` Viewer/PlanButton.
- Before: allowance excludes past_due, so these users reached Pricing as if they had no subscription. Every plan button attempted a new Checkout, while pendingCheckout rejects an existing nonterminal subscription.
- Reproduce: `/api/usage` returns plan null, limit 0, billingStatus past_due; the old button posts checkout.
- Fix: auth continuation sends this status to Settings > Billing. A past-due visitor on Pricing sees Manage billing links instead of checkout buttons. Direct app URLs remain denied and go to Pricing, where Billing is available. Admin/usable-plan handling takes precedence. No duplicate subscription or new payment policy introduced.
- Checks cover the continuation destination and actual Pricing component output for past_due, alongside normal unpaid/paid/admin viewers.

**A4. Checkout return trusted subscription status instead of usable entitlement and stopped too early. Fixed, `b2d2a09`.**

- Evidence: `src/components/billing-view.tsx:28`.
- Before: any billing subscription with active/trialing status triggered studio, even if allowance had no current usable plan. Expired/future periods or mismatched refresh snapshots could bounce back to Pricing. A present nonusable subscription stopped the wait. Once the 30-second waiting state ended, later Refresh did not trigger the redirect effect.
- Reproduce: active subscription object plus usage.plan null at `?paid=1`; old effect navigates to studio. Or let confirmation time out, then refresh to a usable plan; old effect returns immediately because waiting is false.
- Fix: full navigation requires successful usage entitlement (plan or admin), matching the proxy's authorization source. Polling continues without usable entitlement up to the existing fixed deadline. Redirect is independent of waiting, so a later successful Refresh also enters studio. A normal Billing visit does not auto-redirect.
- Checks execute actual effects with active-but-unusable data, simulated timeout, later usable entitlement, ordinary Billing visit and failed reload/stale entitlement. A manually supplied paid=1 never creates entitlement.

**A5. Pricing treated loading and server outages as signed-out signup opportunities. Fixed, `010bde0`.**

- Evidence: `src/components/pricing-page.tsx:99`.
- Before: any non-OK response, parse/network failure or still-loading viewer produced signup links. A paying visitor on a transient usage failure could be asked to create another account.
- Fix: only 401 means signed out. Viewer fetch has a 15-second deadline; errors offer a reload, and loading buttons do not start signup. No plan/cycle/price/style change.
- Checks distinguish 401, 503, unpaid, paid, admin and past_due. Actual unpaid buttons submit the requested plan and monthly/annual cycle to a stub Checkout and follow its returned URL.

### Low / coverage limits

- `/api/media/<id>` reads correctly avoid the paid gate but still require sign-in and route ownership. `/api/media` currently exports only POST, so its paid regex covering every method does not block a valid root read route.
- The proxy interprets allowance failure as unpaid, redirecting pages to Pricing and returning 402 on paid APIs. This is fail closed but misleading during outages; it does not mean the subscription was lost. Distinguishing unavailable with 503 is a future availability improvement, not an entitlement relaxation made here.
- A cached page already rendered in a paid browser tab can remain visible after entitlement expires. The proxy checks network requests, not already held React state. Upload/export/AI paid operations still enforce the next server request. Strict instant removal of cached app UI would need client revalidation and actual browser testing.

## 2. Intended-flow table

“Verified” below means executed against actual components/handlers with explicit service stubs or local SQL. It is not a live Supabase/Google/Stripe test. Functional admin rows remain security-qualified by A0.

| Starting point | Signed out | Signed in, no plan | Signed in, paid/admin |
| --- | --- | --- | --- |
| Landing Sign up, email or Google | Verified: immediate email-session response -> continue -> Pricing; both Google tabs invoke one OAuth door. Live account creation/config unverified | Was broken: popup shown; fixed A1, continue -> Pricing | Was broken: popup shown; fixed A1, continue -> safe next/app |
| Landing Log in, email/password | Verified: wrong/unknown credentials map to plain message; correct response -> continue | Verified -> Pricing | Verified -> next, default studio |
| Landing Log in, Google | Verified: same OAuth call as signup; no “must already exist” restriction | Verified continuation -> Pricing | Verified continuation -> next |
| Sign up with existing email | Verified: error code/legacy message switches modal to Log in with specified message | Not a separate signup path after A1 | Not a separate signup path after A1 |
| App URLs, nested studio/library, `/login`, Get started | Verified signup popup URL with safe next; login entry corrected A2 | Verified gate -> Pricing | Verified normal/RSC/prefetch request passes; login -> studio |
| Pricing plan button | Verified 401 viewer -> signup next=/pricing | Verified stub Checkout for selected plan/monthly/annual; past_due instead -> Billing | Verified Settings > Plans link; matching plan label Your plan, other plans Switch to X |
| Checkout return `/settings/billing?paid=1` | Verified proxy sends signed-out visitors to signup | Verified no entitlement means no studio redirect; waits/refreshes | Was partly broken: status-only/late-refresh handling; fixed A4, usable entitlement -> full studio load |
| `/settings/*` | Verified signup entry | Verified open | Verified open |
| Uploads, POST media, exports | Verified 401 | Verified 402 and needsPlan true | Verified proxy permits; existing upload/export handler suites pass |
| Generate/product/script APIs | Verified proxy 401 | Proxy deliberately passes authenticated users to their own admission; existing generation/AI checks verify plan rejection | Existing generation/AI/SQL suites verify reservation, quota and rate boundaries |

Additional past_due behavior: login continuation goes directly to Billing; direct unpaid app navigation still goes to Pricing with Manage billing. No new Checkout is encouraged for a known delinquent subscription. Text profile editing and sign out stay available. Avatar upload remains subject to the requested paid-upload rule.

## 3. Gate/security and semantics verification

- Inventoried every page under `src/app/(app)`: studio, library, settings and billing are all covered by the matcher. `/billing` is a redirect to `/settings/billing`, which stays available. No extra app page root was found. Proxy has no RSC/prefetch bypass; fixture requests carrying those headers get the same gate decision. Already cached browser UI is a separate limit noted above.
- `mavya_allowance` requires active/trialing status and a current paid period. Extended real PostgreSQL fixtures verify active/trialing allowed; past_due, unpaid and canceled denied; cancellation at period end remains allowed while the paid period is current. Existing annual anniversary/clamping, expired entitlement and quota tests pass. Exhausted generation quota does not remove the plan, so editing/export remain allowed as intended.
- The proxy uses signed getClaims data, not request-body user IDs. Supabase documents email as a normal JWT claim, alongside sub. Email and Google users therefore follow the same claim-based branch in this implementation; actual Google-produced claims were not fetched. [Supabase JWT reference](https://supabase.com/docs/guides/auth/jwt-fields). Signed claim presence does not cure A0's mailbox-ownership issue.
- The service-role key stays in the server-only proxy fetch path, placed in Supabase request headers; the client components do not import the session module or receive this key in JSON/redirects. Tests bind the RPC's user to the claims sub. No real key value was read or printed.
- Normal protected page requests incur getClaims validation/possible refresh plus a fresh no-store allowance RPC; its timeout is eight seconds, with no positive entitlement cache. Settings/public media/other APIs avoid this paid RPC. Auth continuation uses request-bound getUser plus allowance; delinquent/no-plan handling may also read the billing row. Real regional latency and token-refresh timeout behavior were not measured.
- Callback still exchanges the Google code, writes session cookies and loads continue with a sanitized next. The shared Google door is unchanged. Maintenance still intercepts protected app/auth routes. Actual deployed provider settings, cookie/PKCE round trips and browser-router cache behavior were not tested.
- Existing-email and invalid-credential handling agrees with installed Supabase SDK comments and its stable error-code types. Other auth errors, including rate limits and email_not_confirmed, are not silently turned into wrong-password messages. [Supabase error codes](https://supabase.com/docs/guides/auth/debugging/error-codes).
- Supabase controls whether signup returns an immediate session. This app now has no confirmation-email instruction or signup emailRedirectTo. It cannot override or verify the remote Confirm email setting from source alone. The founder's “off” setting must remain off; no production auth-management write was made.

## 4. Checks and commits

All ran with Node 22.23.4:

```text
All 21 scripts/*-checks.cjs         PASS
All scripts/verify-*.cjs            PASS
npx tsc --noEmit -p .               PASS
npx eslint src render              PASS, no warnings
npx next build                     PASS
```

New `scripts/verify-auth-flow.cjs` executes actual modal/host, proxy helper, Pricing and Billing effects using a minimal hook/JSX fixture with all account, provider, browser-navigation and Checkout calls stubbed. It is not a browser DOM/hydration test. Its A0 fixture intentionally demonstrates the still-open admin trust problem; a green run does not mean that vulnerability is fixed.

Existing SQL suites use disposable network-disabled PostgreSQL containers; review-checks runs with cloud environment variables unset and NODE_ENV=test. The new paid-state SQL matrix and delayed-refresh fixture are in `18392d5` (A6). The final full suite, typecheck, lint and build passed after code fixes; the additional SQL/fixture assertions were then rerun successfully. Production build used a separate physical tracked-source/dependency copy without actual .env/.data, preserving the running repository .next. All 32 pages generated. Public font fetches during build are unpaid.

| Commit | Scope |
| --- | --- |
| `bc153f5` | A1 immediate signup, signed-in popup suppression and auth error mapping |
| `3ff6bdf` | A2 login gate and refresh cookies on denials |
| `a1faf62` | A3 delinquent-subscription Billing destination |
| `b2d2a09` | A4 usable entitlement and late confirmation navigation |
| `010bde0` | A5 Pricing outage/loading behavior, final auth-code compatibility/lint annotation |
| `18392d5` | A6 expanded SQL status and delayed-refresh checks |

## 5. Open questions and handoff

1. **Resolve A0 before calling the public admin path secure.** Which immutable user identities are approved admins, or which trusted provisioning restriction should reserve them? No existing production admin IDs or registrations were inspected. This decision can preserve immediate ordinary signup and the Google one-door rule.
2. Confirm the live Supabase Confirm email setting is off, Google is enabled, and callback allowlists match the live origin. These are reported founder settings, not independently authenticated dashboard evidence.
3. A future gate outage response could distinguish unavailable from no plan, rather than treating both as Pricing/402. Paid entitlement still fails closed today.
4. A strict “no app ever” rule must specify already open/cached tabs after expiry. Server paid-operation checks are verified; instant UI revocation is not implemented.
5. Run an authorized live/sandbox browser pass for fresh email signup, duplicate email, Google new/known identity, checkout webhook delay, cookie refresh and sign out. This review created no accounts and initiated no Checkout or paid generation.

No new migrations or environment variables required by the implemented fixes. No Supabase/Stripe/dashboard setting changed. Prior reports' other open generation/font/cron/retention issues are not silently closed by this auth pass.

Stop here for Claude's review. The branch is local and unmerged.
