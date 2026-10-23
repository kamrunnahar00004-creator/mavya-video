# Codex launch fixes, 2026-10-23

Branch: `codex/launch-fixes-2026-10-23`. Implementation commit: `6eb0c0fece23fd83505732a5d5e8f687b3a38b0a`.

This is a partial fix delivery, not launch clearance. I stopped after the first coupled generation/accounting group using the request's explicit instruction to stop at a clean commit if the next work cannot be done safely. H7 requires durable deletion state, Stripe cancellation reconciliation and coordination with concurrent uploads/generation/billing. A cancellation call followed by auth deletion would still lose recovery information or permit new objects during deletion. I did not introduce that incomplete fix. H3/H4/H6 also need a separate transactional billing design and failure tests. The remaining findings below are still open.

No push, merge, deployment, production SQL, live Stripe mutation, paid Runway/fal.ai/Gemini call, email or hosted render job was performed. No `.data` or `.env*` file was committed or deleted. Tests used temporary local data and network-disabled PostgreSQL containers. No browser/audio playback was started.

The branch began at main `dfa86cb`. While work was in progress, three newer prompt commits appeared in the shared checkout: `9b5bf0d`, `8cfc38c`, `c02f979`. They remain intact. The preservation check compares prompt definitions with `c02f979`, not the older `92fbe71` named in the request. This fix commit changes orchestration only in runway.ts.

## 1. Findings and verification

For unchanged findings, "not fixed" means no fix commit and no new verification establishing a fix. The original review remains the evidence; passing general checks does not resolve those findings.

| ID | Status | Changes, verification and commit |
| --- | --- | --- |
| C1 | fixed | `src/app/api/runs/[id]/generate/route.ts` accepts owned database job IDs only; rejects old task/gen/fallback query parameters. `src/lib/server/generation-jobs.ts` owns task IDs, fallback, media registration and settlement. Migration 0003 provides lease/CAS transitions and retains terminal results. `generation-checks.cjs` verifies old-query rejection, missing-job 404, fail-closed reservation and orchestration with stubs; `generation-sql-checks.cjs` verifies ownership, stale-token rejection, one fallback/refund and completion replay. Both PASS. Commit `6eb0c0f`. |
| H1 | fixed | 0003 reserves under a per-user advisory transaction lock before provider work; a unique request key replays the same job. Different keys on an already active run reuse that job. `usage.ts` and reservation fail closed on database errors. SQL test admits exactly 20 of 24 simultaneous independent Starter requests; four return quota errors. Stub test verifies no provider start on reservation failure. PASS. Commit `6eb0c0f`. |
| H2 | fixed | `mavya_allowance` calculates monthly anniversaries inside an annual paid period, clamping from the original UTC anchor rather than drifting after February. Both quota reservation and UI allowance use this RPC. `usage.ts` selects cycle and validates paid dates. SQL tests verify monthly reset/count exclusion, Jan 31 clamping and expired entitlement. PASS. Commit `6eb0c0f`. Limits remain 20/60/150; plans.ts untouched. |
| H3 | not fixed | Atomic webhook claim/order, equal-second reconciliation and lookup failure handling remain open. No fix commit. |
| H4 | not fixed | Billing action writes can still race newer webhook state. No fix commit. |
| H5 | not fixed | Immediate upgrade collection and renewal-time downgrade scheduling remain open. No price or subscription policy changes. No fix commit. |
| H6 | not fixed | One pending Checkout and subscription-identity lifecycle application remain open. No fix commit. |
| H7 | not fixed | Account deletion still lacks cancellation and durable object cleanup. This is the stopping point explained above. No fix commit. |
| H8 | partly | Jobs persist input/reference snapshots, task IDs, result and quota; success writes run hook/history/texts in the same transaction as settlement. Client resumes active jobs, retains POST keys across transport failure and waits for queued saves before starting. A secret-protected cron continues jobs with the browser closed. `generation-edit.ts` retains edited text and puts results into history when source/character/script-beat context changed. SQL tests verify completion CAS, unrelated-section preservation, terminal replay and expired-start recovery. Stub tests verify attachment/history and cron auth. PASS. Commit `6eb0c0f`. Remaining: pre-migration jobs have no recoverable task identity; ambiguous provider create responses need manual recovery; H10's other whole-run writers can still overwrite later data. Real browser reload/navigation and deployed cron behavior were not tested. |
| H9 | not fixed | Upload reservations, immutable finalized objects and authoritative size/expiry checks remain open. No fix commit. |
| H10 | not fixed | Generation completion now uses a row lock plus updatedAt CAS, but general run PATCH/export appends/product/script writes retain the reviewed races. This narrow completion fix does not establish atomicity across all writers. No separate fix commit. |
| H11 | not fixed | Text PNG CSS serialization and outline/hollow parity remain open. No fix commit. |
| H12 | not fixed | Render input/queue/per-user/time/decode limits remain open. No fix commit. |
| M1 | not fixed | Product/script plan authorization and shared rate limits remain open. No fix commit. |
| M2 | not fixed | New `waitRunSaves` is used before generation only. Export's save barrier, editor-local debounce flushing and saved-snapshot parity remain open. No export fix commit. |
| M3 | not fixed | Text PNG batching/upload manifests and silent layer truncation remain open. No fix commit. |
| M4 | not fixed | Client login control-character redirect handling remains open. No fix commit. |
| M5 | not fixed | Generation recovery is independent of the browser; export recovery/temp cleanup is not changed. No export fix commit. |
| M6 | not fixed | Glass backdrop, transformed font subsets, font failures and filter ordering remain open. No visual substitute was introduced. No fix commit. |
| M7 | partly | The generation endpoint refuses local/non-cloud operation and local allowance is zero rather than unlimited. Production-wide configuration validation and other routes' local fallback remain open. Stub tests cover generation's database failure path; type/lint checks PASS. Commit `6eb0c0f`. |
| M8 | partly | Generation POST returns after durable reservation and schedules server work with Next after; both generation and recovery routes declare maxDuration=800. Runway SDK automatic retries are disabled and video-create response ambiguity stops instead of respending. Stub/SQL recovery tests PASS. Export dispatch budgets, full stage deadlines, deployed Fluid Compute/runtime settings and production latency remain unverified. Commit `6eb0c0f`. |
| M9 | not fixed | Profile-aware authoritative media references, inventory caps and delayed garbage collection remain open. No fix commit. |
| L1 | not fixed | Usage database errors now propagate rather than becoming a zero count, but settings transport/error/past_due states and bounded Checkout confirmation remain open. No settings fix commit. |
| L2 | not fixed | Contact delivery/shared budgets and bounded catalog fetches remain open. No messages or remote media tests sent. No fix commit. |
| L3 | partly | Updated startHook's fallback ownership comment and made Runway retry/timeout settings explicit. Prompt preservation test PASS. Other stale comments and deployed Node runtime verification remain open. Local regression run still warns about Node 20. Commit `6eb0c0f`. |

### Commands and outputs

Run from the repository root. No production environment file is loaded by these scripts.

```text
$ npx tsc --noEmit -p .
[no output; exit 0]

$ npx eslint src render
[no output; exit 0]

$ node scripts/review-checks.cjs
[Supabase SDK Node 20 deprecation warning]
PASS: sound migration, piece/gap timing, malformed sections, storage recovery/concurrency, byte ranges, coalesced saves, bounded filmstrip cleanup
[exit 0]

$ node scripts/generation-checks.cjs
PASS: preserved edits/history, stale-input guard, no unreserved spend, server fallback/refund decisions, uncertain start, deterministic output, finalization retry, job-only API, authenticated recovery cron, unchanged founder prompts
[exit 0]

$ node scripts/generation-sql-checks.cjs
[expected IF NOT EXISTS notices on the second application of 0003]
PASS: migration replay, ownership, request replay, parallel quota, shared monthly window, leases, one fallback/refund, completion CAS/replay, uncertain recovery, RPC grants
[exit 0]

$ git diff --check
[no output; exit 0]
```

`review-checks.cjs` additionally asserts the new save barrier waits for a queued successful write and returns false for a rejected write. `generation-checks.cjs` transpiles the actual helper/job/route modules with an explicit import allowlist and stubbed dependencies; unexpected imports fail. It never loads real provider or storage clients. `generation-sql-checks.cjs` needs an already installed `postgres:16` Docker image; it does not pull images. It creates its own container with `--network none`, no host ports, a fixture-only password, applies 0001/0002/0003/0003, exercises real transactions over independent psql connections, then removes that container. It never connects to Supabase. January/February clamping is checked against the current month's boundary with a January 31 original anchor; this is not a full simulated-clock calendar matrix.

No build replaced the founder's `.next` directory. No end-to-end paid generation, live account deletion, payment, cloud cron delivery or browser/device export test was performed.

## 2. Migrations to apply

Only new migration: `supabase/migrations/0003_generation_jobs.sql`, after already applied 0001 and 0002. Do not reapply 0001/0002 in production.

0003 adds job/input/reference/result/refund/lease fields to generations; request and active-run uniqueness; a recovery index; and five service-role-only functions:

1. `mavya_allowance`: shared paid monthly window and refund-aware usage.
2. `mavya_reserve_generation`: owned-run lookup, idempotency and quota reservation in one transaction.
3. `mavya_claim_generation`: exclusive work lease; expired ambiguous starts become uncertain.
4. `mavya_generation_transition`: leased primary/fallback/failure/refund transitions.
5. `mavya_complete_generation`: atomic result settlement and current-run attachment with CAS.

RPC execution is explicitly revoked from PUBLIC, anon and authenticated and granted to service_role. Public clients cannot supply an admin bypass directly. The server derives that bypass from the checked session and ADMIN_EMAILS. Admin jobs still create accounting records. Legacy rows remain counted and are not rewritten into invented recoverable jobs. Failed new jobs retain an audit row and are excluded by refunded_at, rather than deleting another generation record.

The migration is transaction-wrapped and successfully applied twice to a fresh local PostgreSQL 16 fixture. It does not delete runs, generations or user files. It duplicates the existing published limits in SQL, so any future approved limit change must update both the plan definition and SQL deliberately.

For a future reviewed rollout: block generation traffic first, let old in-flight calls drain, reconcile legacy in-flight tasks while their IDs are still available, apply 0003, and deploy this branch's reviewed code with recovery configured before reopening generation. Old browser tabs need a reload because the old task/gen/fallback API is intentionally rejected. Rolling back just the code restores the reviewed vulnerability and loses new job recovery. No rollout action was performed here.

## 3. Environment and platform settings

- New `CRON_SECRET`: a random secret at least 32 characters long. Set it in the deployment environment, never in source. `/api/internal/generations` requires its exact Bearer value and rejects missing/short/incorrect credentials. Vercel supplies that header for its configured cron. Existing authenticated user polling also advances an owned job, but it is not a substitute for unattended recovery.
- `vercel.json` schedules recovery every minute. The route advances one eligible persisted job per invocation and never creates a new reservation. Both proxy maintenance handling and session guards permit the endpoint through to its own secret check. Uncertain jobs are deliberately not restarted by cron.
- The checked-in schedule and 800-second budgets require a hosting plan supporting them. Vercel's current documentation gives Pro/Enterprise a per-minute cron interval and an 800-second Fluid Compute maximum; Hobby is daily cron/300 seconds. Verify the actual project plan, Fluid Compute and deployed runtime before any rollout. If the host cannot support these values, use an equivalent authenticated scheduler/worker and validate it rather than reducing the budgets silently. Sources: [duration limits](https://vercel.com/docs/functions/configuring-functions/duration), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [cron authorization](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
- Existing Supabase public settings, service-role key, R2 settings and Runway/Gemini settings remain required. Missing cloud storage disables generation instead of granting unlimited local generation. This does not implement production-wide startup validation.
- No new Stripe dashboard settings or key permissions in this commit, because the requested Stripe fixes remain open.
- No secrets or cloud dashboard values were inspected or changed. Verify Node 22 or later separately; this local test environment used Node 20.20.0.

## 4. Changes users can notice

- Reloading an active new generation resumes its database job. Server completion stores the output without waiting for the original browser to PATCH it. Closed-tab progress requires the configured recovery scheduler.
- Double clicks/retried requests reuse the same reservation; a run has at most one active generation. Normal primary refusal still falls back once under the same customer charge. A terminal known failure refunds once.
- Annual plans replenish monthly, anchored to the paid start date and clamped in shorter months. Monthly plans keep their paid period window. Prices and published limits are unchanged.
- Generation waits for queued saves and stops if a save failed. Missing cloud accounting returns unavailable instead of starting unrecorded work.
- If acceptance of a paid video-create request cannot be established, the UI asks the user to email support. That is a deliberate safe failure instead of silently launching more paid work.
- If generation context changed while work ran, its output goes into history rather than replacing the current hook. Current edited text is preserved during normal attachment. No page styling, prompt wording or generated-hook postprocessing was changed.

## 5. Open risks and recovery

1. All findings marked not fixed remain real launch risks, especially H3-H7, H9-H12 and M1. This is not a complete response implementation and should not be advertised as launch-ready.
2. There is no demonstrated Runway video-create idempotency/reconciliation contract in this implementation. SDK retries are off. A timeout, connection loss, provider 5xx or process death after dispatch can leave an uncertain job consuming its reserved credit. Do not automatically release its credit or launch another fallback. Support must correlate the provider account's task/spend records with the stored user, run, input and time. Once a task is positively identified, an operator can restore running state with that verified primary/fallback task ID and cleared lease. If non-acceptance is positively established, an operator can mark failed and set refunded_at once. Never clear uncertainty solely because time passed. No operator repair UI or automatic reconciliation is included.
3. Lease duration is 15 minutes and function duration is 800 seconds. An expired starting lease becomes uncertain; an expired running lease can be safely polled again. Slow/hung jobs and recovery backlog need monitoring. A permanently unavailable provider task/download is retried without duplicate spend, but currently has no automatic age-based terminal policy. A single cron job per minute is a conservative recovery path, not a demonstrated throughput target.
4. General run writers still need H10. The completion CAS protects the completion transaction; another stale whole-run writer can subsequently overwrite hook/text sections. Client-local unsaved edits and cross-tab conflicts need the broader revision design. Pre-migration tasks cannot be recovered from missing task IDs. These are why H8 is only partly fixed overall.
5. Account deletion can still race active jobs and does not cancel Stripe or clean R2. Failed finalization after object storage but before ownership registration can leave a deterministic orphan key. H7/H9/M9 need a coordinated deletion/garbage-collection design, not just best-effort DELETE calls.
6. No real production RLS/grants, current balances, Stripe events, provider billing/acceptance behavior, deployment region, scheduler delivery or runtime duration were inspected. Local transaction tests and SDK stubs do not certify those external settings.
7. Studio full-usage margin concerns in the review remain unchanged. Fixing quota leakage does not make the published plan profitable at the reviewed vendor-cost assumptions.

Implementation commit `6eb0c0f` and this separately committed report are for Claude's review. Nothing has been pushed or merged into main.
