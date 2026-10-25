# Codex verification request: sign-up, log-in and the paid gate (2026-10-25)

Live on mavya.app (main `c4f4f3c` or later). Founder rules, decided 2026-10-24/25:

1. **No email confirmation, ever.** Email sign-up signs the person in immediately (Supabase "Confirm email" is off).
2. **Google is one door** ("Continue with Google" on both tabs): an unknown Google account is created, a known one
   signs in. This is the norm (Notion, Figma, Canva, ChatGPT). A short-lived "Log in must not create accounts"
   version was reverted (`f016459`).
3. **No plan, no app.** A signed-in account without a usable plan never reaches the app: it lands on `/pricing`.
   Settings stays open (billing, plans, profile, sign out). Admins (`ADMIN_EMAILS`) are always in.
4. After paying, the person goes straight into the app.

## The intended flow (verify every row)

| Starting point | Signed out | Signed in, no plan | Signed in, paid (or admin) |
| --- | --- | --- | --- |
| Landing **Sign up** (popup, email or Google) | Account created, signed in, `/auth/continue` -> `/pricing` | (popup not shown; links go to the app -> `/pricing`) | -> app |
| Landing **Log in**, email + password | Unknown email or wrong password: "Wrong email or password." Correct: signed in -> `/auth/continue` | -> `/pricing` | -> `next` (default `/studio`) |
| Landing **Log in**, Google | Unknown Google account: created (one door) -> `/pricing`; known -> as the next two columns | -> `/pricing` | -> `next` |
| **Sign up** with an email that already has an account | Popup switches to Log in: "You already have an account. Log in instead." | | |
| Any app URL (`/studio`, `/studio/<id>`, `/library`, `/login`, "Get started" links) | Popup on the landing page (`/?auth=signup&next=...`) | -> `/pricing` | opens |
| `/pricing` plan button | Sign-up popup (`next=/pricing`) | Stripe Checkout for that plan and cycle | "Your plan" / "Switch to X" -> Settings > Plans |
| Back from Checkout (`/settings/billing?paid=1`) | | waits for the webhook, then -> `/studio` (full load) | -> `/studio` |
| `/settings/*` | sign-up popup | open (to pay, fix billing, edit profile) | open |
| API: uploads (`/api/uploads`, `POST /api/media`), exports (`/api/runs/*/export`) | 401 | **402** `{needsPlan: true}` | allowed |
| API: AI (generate, product, script) | 401 | their own allowance checks (402 / plan error) | allowed within limits |

## Changes to verify

- `src/lib/supabase/session.ts` (`5ba42fb`): the proxy gate. `APP_PAGES = ["/studio", "/library"]`, `PAID_API`
  regexes, `paid()` calls `mavya_allowance` through the REST RPC with the service-role key (8 s timeout, fails
  closed), admins by `claims.email` against `ADMIN_EMAILS`. Check: the matcher covers every app page; no path into
  the app is missed (other routes under `src/app/(app)`, client navigation with prefetch, RSC requests, `/billing`
  redirect); `claims.email` is present for Google and email users; `mavya_allowance` semantics (past_due, cancelling,
  annual) match "usable plan"; latency and failure behaviour per request; the service key never reaches the client;
  `/api/media/<id>` reads stay open (playback) while `POST /api/media` is gated.
- `src/components/auth-modal.tsx` (`a0e5fa9`): plain messages for existing email on sign-up (switches to Log in) and
  invalid credentials. Check the regexes against Supabase's real error strings and that no other error is masked.
- `src/components/billing-view.tsx` (`c4f4f3c`): after `?paid=1`, an active/trialing plan opens `/studio` with a full
  load. Check races with the webhook, the proxy gate seeing the plan, and users who land there without paying.
- `src/components/pricing-page.tsx` (`1c20bcc`) and `src/app/auth/continue/route.ts`: viewer detection via
  `/api/usage`, checkout for signed-in unpaid users, `next` handling.
- **past_due users** now land on `/pricing` (plan lookup excludes past_due) where Checkout is blocked because a
  subscription exists. Propose the right behaviour (probably Settings > Billing to update the card) and implement it if
  small and safe.

## Rules

Same as before: branch `codex/verify-auth-2026-10-25` from `main`, no push/merge, one commit per finding, no paid or
live Stripe calls, no price/limit/prompt/model/UI-style changes, keep all `scripts/*-checks.cjs` and
`scripts/verify-*.cjs`, `tsc`, `eslint src render` and `next build` passing (Node 22). Add checks for the gate
(every row of the table above that can be tested with stubs).

## Report

`docs/CODEX_VERIFY_REPORT_2026-10-25_AUTH_FLOW.md`: findings ranked, the table above marked verified / broken per
row, fixes with commits, open questions. Then stop for Claude's review.
