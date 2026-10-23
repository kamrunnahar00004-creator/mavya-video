# Codex fix request: launch review findings (2026-10-23)

Fix the findings in `docs/CODEX_REVIEW_2026-10-23.md` (your own review of this repo). mavya.app is **live and
public**, so money and data findings come first. Claude will verify every fix after you report, so make each one easy
to check: small commits, a test or a reproducible check for each.

## Ground rules

- Work on a new branch `codex/launch-fixes-2026-10-23` from `main`. **Do not push and do not merge into main**: every
  push to main deploys the live site. Claude reviews, then merges and pushes.
- Commit identity must stay `kamrunnahar00004-creator` (repo-local git config; Vercel blocks other authors).
- **One commit per finding** (or per tightly coupled group, e.g. C1+H1+H8), message starting with the finding id,
  e.g. `C1/H1/H8: server-owned generation jobs`.
- Database changes go in a **new** migration file `supabase/migrations/0003_<name>.sql` (and 0004... if needed). Never
  edit 0001/0002 (already applied in production). The founder applies migrations by hand in the Supabase SQL editor,
  so each must be idempotent where reasonable (`if not exists`), self-contained and listed in your report.
- Keep `npx tsc --noEmit -p .`, `npx eslint src render` and `node scripts/review-checks.cjs` passing. Add focused
  checks to `scripts/review-checks.cjs` (or a new `scripts/*-checks.cjs`) for the logic you change, with external
  services stubbed, like your review did.
- **Never call Runway, fal.ai, Gemini or live Stripe** (real money). Stub them.
- Do not change prices or plan limits (`src/lib/plans.ts`), do not add product features, do not restyle UI.
  User-facing copy: short, no em dashes, no helper/filler lines.
- Do **not** touch the prompt wording in `src/lib/server/runway.ts` (`PLAN_PROMPT`, `performanceText`, `UGC`,
  `NEGATIVE*`, `veoPrompt`, the swap prompt): the founder just tuned it (commit 92fbe71). Moving the generation
  start/check logic around it is fine.
- No ffmpeg post-processing of generated hooks (founder decision).

## What to fix, in this order

1. **C1 + H1 + H8 (one design): server-owned generation jobs.** A `generations`/job row created atomically with the
   quota reservation (Postgres function/RPC, fail closed), owning user, run, primary and fallback task ids, state,
   and result. Poll by job id only; the server decides fallback (at most once, atomically claimed) and refund
   (exactly once). On success the server itself writes the hook into the run (`hook.generated`, history versions),
   so a reload or closed tab loses nothing; the client resumes an unfinished job on load. Idempotency key on POST.
   Keep the current behaviour users see: automatic fallback, no rejections shown, fallback not charged twice.
2. **H2**: yearly plans get the monthly allowance each month inside the paid year (cycle selected, same window used
   by reservation and the UI reset date).
3. **H7**: delete account cancels the Stripe subscription (or fails with a clear message), deletes the user's R2
   objects, then the auth user; idempotent.
4. **H3 + H4 + H6**: atomic webhook claim + ordered state apply in one transaction; billing actions never overwrite a
   newer webhook state or lower the watermark; one pending Checkout per user (reuse or idempotency key); lifecycle
   events applied by subscription id so an old subscription can't erase the current one; fail closed on lookup errors.
5. **H5**: upgrades: collect the upgrade payment before granting the higher allowance (e.g. `proration_behavior:
   "always_invoice"` + `payment_behavior: "error_if_incomplete"`, or equivalent), and schedule downgrades for the
   next renewal. No price changes.
6. **H9**: upload reservations bound to user, type, size and expiry; finish authorized against the reservation.
7. **H10**: run updates merged atomically in Postgres (revision/CAS or `jsonb` merge in a function); exports appended
   idempotently by media id; AI product/script results applied only if their input still matches.
8. **M1**: product/script Gemini routes need a plan (or the admin list) and a per-user rate limit.
9. **H12, M5, M8**: render worker limits (job/input size, queue cap, per-user one at a time), export finalization not
   dependent on the browser (server finalizes on poll from any session, temp cleanup), sensible `maxDuration`s.
10. **M2, M3, H11, M6**: export parity: flush saves before export and export from the saved run; text layers never
    silently dropped (batch/upload the PNGs if the request is too large); outline/gradient/hollow styles match the
    preview (fix in `src/lib/text-png.ts`).
11. **M4, M7, M9, L1–L3**: as described in the review.

If something is too large or risky to do well, stop at a clean commit and explain in the report what is left and why,
rather than half-fixing it.

## Report

Write `docs/CODEX_FIX_REPORT_2026-10-23.md`:
1. For each finding id: **fixed / partly / not fixed**, what changed (files), how you verified it (the check you added
   or ran, with its output), and the commit hash.
2. **Migrations to apply**, in order, with what each does.
3. Any new environment variables or Stripe dashboard settings needed.
4. Anything you changed that a user will notice.
5. Open risks.

Commit the report on the branch too. Then stop: Claude checks the branch before anything reaches main.
