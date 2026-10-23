# Codex fix request, part 2: the remaining launch findings (2026-10-23)

Thanks for part 1 (C1/H1/H2, H8 partly, commit `6eb0c0f`). Claude reviewed it and built on it. Continue on the **same
branch** `codex/launch-fixes-2026-10-23`, from its current head (`1b5d5e1` or later). Same ground rules as
`docs/CODEX_FIX_REQUEST_2026-10-23.md`: no push or merge, one commit per finding (or tightly coupled group), new
migrations as `supabase/migrations/0004_*.sql` and up (0001-0003 are applied or about to be; never edit them),
tests with external services stubbed, `tsc`, `eslint src render`, `review-checks`, `generation-checks` and
`generation-sql-checks` passing, no paid calls (fal.ai, Gemini, live Stripe), no price or limit changes, no UI
restyling, short copy without em dashes.

## What changed since part 1 (do not undo)

- **Hook generation moved from Runway/Veo to Kling Motion Control on fal.ai** (founder decision after side-by-side
  tests): `src/lib/server/hookgen.ts` replaces `runway.ts`. Task ids are `"<fal model>|<request id>"`; `checkHook`
  polls fal's queue; a submit with no response throws `HookStartUncertain`; `checkHook` returns `seconds` (the
  output's real length). Your job system (`generation-jobs.ts`, 0003) is unchanged apart from that import and
  `seconds: task.seconds`. Do not change the prompts or model choices in `hookgen.ts`; orchestration/safety changes
  around them are fine.
- `RUNWAYML_API_SECRET` is no longer used; `FAL_KEY` is. Your prompt-preservation check was removed (those Veo
  prompts no longer exist).
- The founder will upgrade Vercel to Pro (your per-minute cron and 800 s budgets stay).

## Fix next, in this order

1. **H3 + H4 + H6 (billing state, one design).** Webhook: claim the event and apply ordered state in one Postgres
   transaction (RPC), equal-second events reconciled against the subscription's current state from Stripe, lookup
   failures fail closed (500 so Stripe retries) and are not marked done. Billing actions (`/api/billing` change,
   cancel, resume) must never overwrite a newer webhook state or lower the watermark (conditional write on
   subscription id + watermark, or drop the immediate write and let the page poll the webhook result). One pending
   Checkout per user (reuse an open session or a Stripe idempotency key), and lifecycle events applied by
   subscription id so an older subscription can never erase the current one; a second paid subscription for the same
   user is detected and logged for support (do not auto-refund).
2. **H5 (upgrade before payment).** Upgrades charge the prorated difference immediately and grant the higher
   allowance only after that payment succeeds (`proration_behavior: "always_invoice"` with
   `payment_behavior: "error_if_incomplete"`, or equivalent); downgrades are scheduled for the next renewal. No price
   changes. Billing page copy stays short.
3. **H7 (delete account).** Durable deletion: record the request, cancel the Stripe subscription (immediately, no
   refund) or stop with a clear error, block new uploads/generations for that user, delete their R2 objects
   (`media/<their ids>`), then the auth user. Idempotent and resumable.
4. **H9 (uploads).** Upload reservations bound to user, mime, declared size and expiry; `finish` only for the
   reservation owner; size checked with HEAD against the declared size and a cap; abandoned reservations expire.
5. **H10 (run writes).** Atomic section merge in Postgres for run PATCH (revision/CAS or jsonb merge RPC); exports
   appended idempotently by media id; product/script AI results applied only if their input still matches.
6. **M1** product/script Gemini routes need a plan (or admin) plus a per-user rate limit. **H12** render server:
   input size cap, queue cap, one job per user, per-job time limit. **M5** export finalization from any poll plus
   temp cleanup. **M2/M3** export reads the saved run after a save barrier; text PNGs never silently dropped.
   **H11/M6** text style parity in `src/lib/text-png.ts`.
7. **M4, M7, M8, M9, L1, L2, L3** as in the review.

If one item would take a risky half-fix, stop at a clean commit and explain, as you did.

## Report

Append a **Part 2** section to `docs/CODEX_FIX_REPORT_2026-10-23.md` in the same format (status per id, files,
verification output, commit), list new migrations in order, any new env vars or Stripe dashboard settings, and
user-visible changes. Then stop for Claude's review.
