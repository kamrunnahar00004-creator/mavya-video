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

## Part 2: billing state and Kling job compatibility

Continued on `codex/launch-fixes-2026-10-23` from `2e2e54a`, after the founder's Kling commit `1b5d5e1`. Implementation commits:

- `711e8a2`: H3/H4/H6, serialized billing reconciliation and persistent Checkout identity.
- `9b1ebdc`: C1/H8, accept fal task identities in the durable generation transition.

This is another bounded delivery, not completion of the full request. I stopped at the next item, H5, under Part 2's explicit safe-stopping instruction. Immediate collection must be coordinated with durable payment-operation retries, renewal schedules, discounts, monthly/annual transitions and cancel/resume of an already scheduled change. Simply changing two subscription-update flags would leave the downgrade/credit path and schedule recovery inconsistent. I left H5 unchanged instead of shipping that half-fix. Later items remain open in the requested order. These commits are not launch clearance.

### Part 2 status per finding

| ID | Current status | Part 2 changes, verification and commit |
| --- | --- | --- |
| C1 | fixed | Found and corrected the new Kling integration's task-ID mismatch: 0003's UUID-only transition would reject `model\|request-id` after a paid submission. New migration 0005 accepts bounded fal identities and strict legacy UUIDs while preserving lease/owner/CAS checks. SQL regression uses an actual-format fal task for the fallback, verifies it is stored, and rejects URLs/multiple separators. PASS. Commit `9b1ebdc`. No hookgen.ts changes. |
| H1 | fixed | Part 1 atomic reservation design retained. Required generation regression and SQL suites PASS after all new migrations. No Part 2 accounting-policy change. |
| H2 | fixed | Part 1 shared monthly anniversary window retained. Annual/clamping SQL checks PASS. No Part 2 allowance/price/limit change. |
| H3 | fixed | `src/app/api/stripe/webhook/route.ts`, `src/lib/server/billing-state.ts`, 0004: obtain a per-account database lease before the authoritative Stripe retrieve. Event insertion and ordered state application happen together in `mavya_billing_event`; exceptions roll back the event claim. Strictly older events cannot lower the watermark. Equal-second deliveries are serialized and reconcile current Stripe state rather than their payload snapshots. Owner/DB/provider failures return 500 without acknowledging an applied event. SQL checks cover concurrent leases, replay, older/equal timestamps, rollback and expired tokens. Stub checks prove retrieve occurs under the lease, uses fresh canceled state despite an active event payload, and fails closed on lookup/owner/lease errors. PASS. Commit `711e8a2`. |
| H4 | fixed | Billing POST actions read current account state inside the same lease. Immediate writes use `mavya_billing_action` with subscription ID, billing_revision and last_event_created as conditions; the RPC never changes the watermark. Expired/stale leases and revisions cannot apply. `src/app/api/billing/route.ts` no longer unconditionally upserts subscription rows. SQL test applies a newer webhook before a stale action and confirms rejection with watermark/status preserved; successful actions increase revision only. Stub test rejects a failed CAS. PASS. Commit `711e8a2`. |
| H5 | not fixed | Upgrade updates still use create_prorations and downgrades remain immediate. Immediate collected upgrades, durable payment retry identity, renewal schedules and matching cancel/resume handling are not implemented. This is the stopping point described above. No H5 fix commit. |
| H6 | fixed | 0004 adds per-user persistent billing_checkouts with exact creation parameters and a stable UUID key saved before Stripe create. Under the account lease, retries reuse the open session or the same Stripe idempotency key. Different plan selection cannot create a second concurrent checkout. A confirmed expired session can be replaced; a completed one blocks another purchase until reconciled. Subscription IDs are bound to owners; retired IDs cannot overwrite the current subscription. A different live subscription produces a durable billing_conflicts row and a support log, never an automatic refund. SQL tests cover Checkout identity, unchanged saved parameters, expiry/resubscribe, retired-event isolation and duplicate auditing. Stub tests reproduce a lost create response, reuse the identical key/parameters despite changed email/origin, reuse known sessions and block unsafe old-key replay. PASS. Commit `711e8a2`. Legacy pre-migration open Checkout sessions require separate cutover handling. |
| H7 | not fixed | Durable deletion, immediate Stripe cancellation, write blocking, R2 cleanup and auth deletion remain open. No Part 2 changes or fix verification. |
| H8 | partly | Migration 0005 prevents fal task IDs being lost solely because the old UUID validator rejected them. Existing durable-job recovery tests PASS. Preexisting uncertain jobs, general stale writers, deployed scheduler behavior and actual browser reload tests remain unresolved as described in Part 1. Commit `9b1ebdc`. |
| H9 | not fixed | Upload reservations/ownership/size/expiry/immutable finalization remain open. No Part 2 changes or fix verification. |
| H10 | not fixed | General atomic run section merging, export append identity and AI input CAS remain open. No Part 2 changes or fix verification. |
| H11 | not fixed | Text PNG outline/hollow serialization remains open. No Part 2 changes or fix verification. |
| H12 | not fixed | Worker queue/input/user/time limits remain open. No Part 2 changes or fix verification. |
| M1 | not fixed | Product/script entitlement and per-user rate limits remain open. No Part 2 changes or fix verification. |
| M2 | not fixed | Export save barrier and saved-run snapshot remain open. No Part 2 changes or fix verification. |
| M3 | not fixed | Export PNG upload/batching and silent layer loss remain open. No Part 2 changes or fix verification. |
| M4 | not fixed | Client login control-character redirects remain open. No Part 2 changes or fix verification. |
| M5 | not fixed | Independent export finalization and temp cleanup remain open. No Part 2 changes or fix verification. |
| M6 | not fixed | Glass/font/filter parity remains open. No Part 2 changes or fix verification. |
| M7 | partly | Billing row lookup failures now block billing actions instead of being treated as no subscription; billing GET returns unavailable on its initial DB lookup failure. Stub tests PASS. Production-wide configuration validation remains open. Commit `711e8a2`. |
| M8 | partly | Billing/webhook routes declare 120-second budgets; Stripe SDK requests have a 20-second timeout and automatic network retries disabled. A 3-minute database lease covers reconciliation, and stale workers cannot commit afterward. Deployed budgets/runtime, generation stage limits and export dispatch remain unverified/open. Type/lint and lease tests PASS. Commit `711e8a2`. |
| M9 | not fixed | Profile-aware reference checks, inventory limits and garbage collection remain open. No Part 2 changes or fix verification. |
| L1 | not fixed | Server billing DB errors now return unavailable, but client settings still lack distinct transport-failure states and bounded monotonic polling. No client settings fix or verification. |
| L2 | not fixed | Contact delivery/shared limiting and catalog fetch bounds remain open. No Part 2 changes or fix verification. |
| L3 | partly | Billing comments now describe conditional action writes rather than claiming the webhook is the sole writer. Stripe timeout/retry assumptions are explicit. Other stale comments and Node runtime work remain open. Commit `711e8a2`. |

### Part 2 checks and output

All external service dependencies in the new JS tests are explicit stubs; unexpected imports throw. No Stripe API client, fal.ai, Gemini or other paid service was called. The SQL checks use independent psql connections to a disposable PostgreSQL 16 Docker container with no network or host ports. Test-owned containers are removed afterward. No browser was opened or audio played.

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
PASS: preserved edits/history, stale-input guard, no unreserved spend, server fallback/refund decisions, uncertain start, deterministic output, finalization retry, job-only API, authenticated recovery cron
[exit 0]

$ node scripts/generation-sql-checks.cjs
[expected migration replay notices]
[two expected Invalid provider task exceptions caught by negative assertions]
PASS: migration replay, ownership, request replay, parallel quota, shared monthly window, leases, bound legacy/fal task IDs, one fallback/refund, completion CAS/replay, uncertain recovery, RPC grants
[exit 0]

$ node scripts/billing-checks.cjs
PASS: lost Checkout response reuses persisted parameters/key, existing session reuse, old unknown-create recovery, busy lease, lookup fail closed, action CAS failure, webhook fresh state under lease, owner mismatch/signature guards, no paid imports
[exit 0]

$ node scripts/billing-sql-checks.cjs
PASS: billing migration replay, parallel account lease, transactional event replay/rollback/order, equal-second apply, action CAS/watermark, expired leases, duplicate subscription audit, retired identity isolation, persisted Checkout identity/params, expiry/resubscribe, RPC grants
[exit 0]

$ git diff --check
[no output; exit 0]

$ git diff 1b5d5e1 -- src/lib/server/hookgen.ts src/lib/plans.ts
[no output]
```

New tests: `scripts/billing-checks.cjs`, `scripts/billing-sql-checks.cjs`. Updated: `scripts/generation-sql-checks.cjs` now applies 0004/0005 and repeats 0005. The separate billing fixture repeats 0004. No working build directory was replaced. Passing these tests establishes the listed control flow and local transaction properties, not live Stripe behavior or dashboard configuration.

### Part 2 migrations, in order

After the existing 0001-0003, apply:

1. `supabase/migrations/0004_billing_state.sql`: adds subscriptions.billing_revision; service-only billing leases, pending Checkouts, subscription-ID bindings and conflict audit tables with RLS; backfills current subscription identities. Adds service-role-only lock/unlock, Checkout prepare/record/clear, transactional webhook claim/apply and action CAS RPCs. Fresh PostgreSQL 16 application and replay both pass. No run or media data is deleted.
2. `supabase/migrations/0005_generation_provider_ids.sql`: replaces only the existing transition function to validate fal `model|request-id` or strict legacy UUIDs, retaining the state machine and restrictive grants. Fresh application and replay pass. No job is restarted, refunded, deleted or rewritten by this migration.

Do not edit or reapply 0001-0003 to deliver these fixes. Apply the new migrations before enabling the new route code in a future reviewed rollout. Neither has been applied to production here.

### Part 2 environment and Stripe settings

- No new environment variables. Existing STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, six configured price IDs, Supabase settings and Part 1 CRON_SECRET remain required. Kling uses FAL_KEY as introduced by the founder; RUNWAYML_API_SECRET is not reintroduced. No model or prompt choices changed.
- The restricted Stripe key now needs Checkout Sessions **read** as well as create, because retries retrieve known sessions. Subscriptions read/update, existing customer/invoice reads and card-portal permissions remain necessary. Verify sandbox-equivalent permissions without exposing the key. No Schedule, Refund, Event retrieval or invoice-pay API is used by this implementation.
- Continue subscribing to checkout.session.completed, customer.subscription.created/updated/deleted and invoice.paid. Unknown/unresolvable subscription owners now cause 500 for retry and an error log, rather than an acknowledged discarded change. Monitor and repair those errors.
- Verify that the configured 120-second billing/webhook budgets and existing 800-second generation budgets are supported by the actual Vercel Pro/Fluid Compute setup. No hosting setting or upgrade was performed here.
- Deployment must address already-open legacy Checkout sessions. New persistent idempotency cannot invalidate previously issued Stripe links. Confirm/expire those sessions through an authorized operational procedure before reopening purchasing; no live sessions were modified here.

Reference checks used official Stripe documentation: [webhook ordering and retries](https://docs.stripe.com/webhooks), [Checkout sessions](https://docs.stripe.com/api/checkout/sessions/create), [subscription update and immediate collection](https://docs.stripe.com/api/subscriptions/update), [renewal schedules](https://docs.stripe.com/api/subscription_schedules/create). Documentation reads do not verify the live account's API version or permissions.

### Part 2 user-visible behavior

- Concurrent billing mutations can return "Billing is updating. Try again." rather than racing. A stale action cannot restore an older subscription state or lower event time.
- Retrying Checkout reopens the existing open session. Choosing a different plan while one is open asks the user to finish that checkout first; a second session is not created. Completed payments wait for reconciliation instead of offering another purchase.
- Initial billing database outages return an error, not an empty subscription that permits Checkout. Client error-state presentation still needs L1.
- Retired subscription updates/deletions leave the current subscription intact. A second live subscription is logged for support review, not automatically canceled or refunded.
- New Kling jobs can persist their provider identity. Prompts, model choices, prices, limits, styling and generated-hook processing are unchanged.

### Part 2 risks and recovery

1. **H5 remains a money risk:** the old upgrade/downgrade proration policy is still present. H7, H9-H12, M1 and the remaining export/auth/operational findings remain open. Do not describe this branch as fully launch-safe.
2. A lost Checkout response uses the saved exact parameters and Stripe idempotency key. Stripe can prune keys after 24 hours, so an unknown session without a recorded ID is deliberately blocked after 23 hours and asks for support. Do not delete that row or rotate the key just to unblock purchasing. Support must first establish whether the original session/subscription exists. Confirmed expired sessions may be cleared safely. A completed session can be cleared for resubscription only after its matching current subscription is terminal, verified through Stripe and the database.
3. Review billing_conflicts and duplicate-subscription logs. The transaction preserves the current subscription and records incoming paid identities; it does not resolve existing double billing, cancel a second subscription or issue refunds. Retired identity events are ignored; a legitimate replacement after cancellation is accepted through the matching persisted Checkout session. Externally created replacements without that identity require support reconciliation rather than silently taking over the account.
4. Webhook state retrieval is serialized locally, but Stripe can change after retrieval. A subsequent event reconciles that newer state. Database leases expire after three minutes; an expired worker cannot apply. A crashed worker delays retries until lease expiry. During a lease conflict webhooks return 500 so Stripe retries. The implementation does not claim to prevent changes made directly in Stripe or to replace operational reconciliation.
5. A Stripe action can succeed while the following database commit fails. The route returns an error; a webhook must reconcile the remote state. Do not infer a failed remote mutation solely from the HTTP error. Durable payment-operation identity is part of the next H5 work before immediate collection is introduced.
6. Fal submissions made before 0005 may already have lost their returned ID when 0003 rejected it. Applying 0005 does not repair those jobs or establish whether they were charged. Correlate the provider's request/spend history with the job's owner/input/time before binding a verified task or issuing a credit. Never automatically resubmit an uncertain job.
7. Production migrations, RLS, actual Stripe API/restricted-key behavior, webhook delivery/retries, sandbox payment failures, UI polling and closed-tab cloud recovery were not exercised. No live paid calls, production writes, pushes, merges or deployment occurred. The local identity remains kamrunnahar00004-creator.

## Part 3: remaining findings, Hobby hosting

Continued on `codex/launch-fixes-2026-10-23` from `0b013a7`. Worked through every independent item in the brief in this session. No push, merge, deployment, production database mutation, live payment, paid fal.ai/Gemini call or email was performed. No browser or audio playback was started. No repository `.data` or `.env*` file was committed or deleted, and the founder's `.next` directory was not replaced.

**Hosting policy supersedes the older sections:** Vercel stays on Hobby. Every declared Next function budget is at most 300 seconds. The existing recovery schedule remains `0 4 * * *`, once daily. User requests/polls advance their own work; no per-minute or Pro-only infrastructure is assumed. The separate render service's job deadline is 15 minutes; that is not a Vercel function budget.

### Part 3 finding status

"Fixed" below describes the repository behavior covered by the listed source checks, fixtures and tests. It does not certify deployed settings or live vendor behavior. Remaining limits are listed afterward.

| ID | Status | Changes/files, verification and commits |
| --- | --- | --- |
| C1 | fixed | Existing owned, leased generation jobs retained. `hookgen.ts` now treats a successful submit without a valid task ID as uncertain, and unknown status/transient result HTTP failures do not authorize another paid fallback. `provider-safety-checks` exercises these cases with fake responses; generation and SQL suites PASS. `e355c10`. |
| H1 | fixed | Atomic quota reservation and single fallback/refund retained. Closing-account triggers additionally reject new reservations. Generation SQL race/grant checks PASS. Part 1 fix retained; `a11d163`, `68edf7f` add deletion safety. |
| H2 | fixed | Monthly anniversary allowance for annual plans unchanged. Existing SQL allowance/clamping checks PASS. No Part 3 price or allowance change. |
| H3 | fixed | Part 2 lease and transactional event ordering retained. Late events for deleting/deleted accounts use an atomic deletion-tombstone event claim instead of trying to recreate an auth-bound subscription row. `stripe/webhook/route.ts`, 0013; billing stub and SQL suites PASS, including rollback under an active deletion lease and post-auth events. `2596843`. |
| H4 | fixed | Part 2 subscription/revision/watermark CAS remains the action writer; collected upgrades also use that writer. Stale-action/ordering SQL and billing stub checks PASS. `ea3cee1` builds on the accepted Part 2 fix. |
| H5 | fixed | `billing-change.ts` applies same-cycle upgrades with always_invoice + error_if_incomplete and a stable retry key; only successful active, matching-price results are applied. Lower plans and all cycle switches become schedule phases at renewal with no immediate proration. Cancel/resume release pending schedules. Billing displays the scheduled target/date; confirmation copy describes the actual selected policy. Declined-payment fixture preserves both old plan and pending schedule; schedule/cycle tests PASS. `ea3cee1`, `3245897`. Advanced/manual subscription configurations fail safely for support rather than being rewritten. |
| H6 | fixed | Part 2 persistent Checkout identity/session reuse retained. Late paid subscriptions belonging to a deleted account are queued on its durable deletion record and canceled without refund; ordinary duplicate active subscriptions still require support review. Billing and SQL suites PASS. `2596843`, accepted Part 2 fixes retained. |
| H7 | fixed | `account-deletion.ts`, `account-state.ts`, account route, generation worker, 0006/0007/0009/0012/0013/0014: durable request survives auth deletion, cancellation/Checkout expiry precede cleanup, writes are blocked, strict R2 deletion precedes auth removal, and cursor/lease state permits retries. Snapshot includes registered media, reservations/staging, export outputs/overlays, deterministic late generation outputs and owned provider staging keys. Current subscription is prioritized. Cancellation failures retain the account and return a clear error. Cleanup waits six hours plus two minutes for grants and bounded in-flight renderer uploads, then advances in batches. Late Stripe lifecycle events use the tombstone. Deletion stubs and full SQL checks PASS. `a11d163`, `4f81b7b`, `c1f0e4f`, `68edf7f`, `2596843`, `33b6199`. |
| H8 | partly | Existing durable recovery retained; owned provider staging and ambiguous fal response handling strengthen it. Truncated MP4 v1 headers no longer throw during duration parsing. Generation/provider/budget/SQL checks PASS. `e355c10`, `68edf7f`. Lost submit identity still requires manual reconciliation; Hobby daily recovery and same-section editing conflicts are not an assurance of immediate unattended completion. |
| H9 | fixed | `uploads.ts`, uploads route, `r2.ts`, 0007/0009: reservations bind owner, MIME, exact declared size and expiry. Browser uploads go to staging; finish uses an owned lease, HEAD size/type and ETag-conditional copy into the canonical key, then atomically records media/assets. Replaying the PUT cannot overwrite finalized media. Expired work is collected in bounded batches. Offline real AWS signing verifies Content-Length is signed and avoids an empty-body checksum; no HTTP is allowed in that signing fixture. Upload, signing and SQL checks PASS. `4f81b7b`, `f92960c`, temporary export handling in `c1f0e4f`. |
| H10 | fixed | `store.ts`, `ai-budget.ts`, product/script/export routes, 0008/0011: Postgres merges run sections atomically and appends exports once by owned media ID. AI results require the latest request token and unchanged saved run timestamp; script completion also locks/checks the source reference snapshot. Different-section writes, repeated export append, superseded AI requests, edited runs and changed reference input are covered by SQL tests. All PASS. `6eb2619`, `e3c2c61`. Same-section editor writes remain last-writer-wins; the AI guard deliberately rejects even unrelated run edits during a request. |
| H11 | fixed | `text-png.ts`: correct single Webkit prefix for stroke/fill/clip/box decoration; non-empty text producing no pixels throws instead of being omitted. `text-checks` verifies every property emitted by all 50 style presets, with explicit stroke/fill/clip assertions. PASS. `b0854bb`. Actual cross-browser pixels remain an unverified coverage limit. |
| H12 | fixed | `render/limits.mjs`, `render/server.mjs`: fixed output envelope, segment/piece/sound/overlay count and duration bounds, 300 MiB/file and 600 MiB/job input bytes, four concurrent downloads, input dimension/duration checks, 32 Mi decoded overlay-pixel budget, eight queued jobs, one active job/user, request/body budgets, job/process deadlines, bounded stderr, streamed output upload and correct queue expiry. Job IDs replay only identical payloads. Pure limit tests and a real local HTTP worker test cover auth, replay/conflict, per-user exclusion and queue saturation; all external fetches are blocked in that worker. PASS. `510a183`, `0e5bcf8`, `987d1cd`. Host load/RAM measurements remain outstanding. |
| M1 | fixed | Product/script routes require a paid entitlement or checked admin, then atomically reserve a daily per-user budget: 30 product reads, 60 scripts, UTC day. Failures still consume their request budget. Admin bypass is entitlement-only, not a rate bypass. New AI guard/SQL tests cover no plan, limit exhaustion and stale completion. PASS. `6eb2619`. |
| M2 | fixed | `run-view.tsx` flushes its local text/adjustment timers before export; `ExportButton` waits for successful queued writes, loads the saved run and draws that snapshot. The server checks snapshot equality again when reserving the job. Save-barrier regressions and stale export-reservation SQL checks PASS. `c1f0e4f`. No real browser editor-click matrix was run. |
| M3 | fixed | `ExportButton`, `export-layers.ts`, upload/export routes, 0009: PNGs upload individually through owner reservations; POST carries a small manifest, not base64. Every visible saved text ID must have exactly one owned temporary PNG; missing/duplicate/expired manifests fail the whole export. No .slice(0,40) or silently skipped invalid image remains. Existing 200-layer validation ceiling is retained; resource excess fails explicitly rather than dropping layers. Export/upload/SQL tests and type checks PASS. `c1f0e4f`. |
| M4 | fixed | `auth-next.ts` is shared by client modal and server callback. It rejects controls, protocol-relative and backslash destinations before parsing, then verifies origin. URL normalization regression cases PASS. `6410a72`. |
| M5 | fixed | `export-jobs.ts`, export/recovery routes, 0009/0012: persist job/output/manifest identity before dispatch, resume by owned job from another session, recover from the actual R2 output even if renderer memory is gone, append once, and retry bounded temporary cleanup. Worker protocol 2 is required before dispatch, preventing retries against an older worker that ignores job IDs. Temporary PNGs and provider staging have owned expiry ledgers. Output-recovery, cleanup-replay, SQL, worker admission and protocol checks PASS. `c1f0e4f`, `68edf7f`, `45f4100`. Unattended daily-cron throughput is limited below. |
| M6 | partly | `text-png.ts` subsets uppercase glyphs for transformed styles and fails on missing required font CSS/files; fetches have deadlines. `adjust.ts` and renderer now apply brightness, contrast/saturation, then warmth in preview order. Serializer/filter-order assertions PASS. `46ac666`. Transparent text PNGs still cannot implement Glass/Dark glass backdrop blur against video, and no full golden-pixel/browser/font matrix was run. No substitute style was silently chosen. |
| M7 | fixed | `production-config.ts`, proxy, Supabase and R2 helpers refuse protected production service when required auth, service-role or storage settings are missing. Local mode remains development-only. Each missing setting is tested independently; PASS. `df405db`. Actual deployed values remain uninspected. |
| M8 | partly | Hobby budgets checked across all route files; daily schedule unchanged. `work-budget.ts` gives generation setup a 210-second deadline propagated through Gemini, fal, ffmpeg, R2 and bounded database HTTP; provider acceptance uncertainty remains durable. Export dispatch/finalization is resumable within 300-second requests. Budget/prompt-preservation and existing suites PASS. `ff1deb5`, `2a34b97`, `c1f0e4f`. Real cold starts, vendor latency, deployment kill behavior and recovery capacity were not measured. |
| M9 | partly | Chosen safe policy: removing a cloud asset unlists it but retains owned canonical media until account deletion. It no longer scans capped run/library lists to decide destruction, so profile use, older projects and concurrent new references cannot be broken by that deletion path. Dedicated cloud fixture confirms only the assets table is changed; PASS. `d159440`. Active-account garbage reclamation is deliberately deferred; storage growth remains a cost risk. |
| L1 | fixed | Settings reloads use deadlines and single-flight requests, retain prior successful data and expose failure distinctly. Plans cannot invite another purchase while loading failed. Checkout confirmation has a fixed 30-second deadline and a refresh path; Usage distinguishes past_due from no plan. Billing detail failures return unavailable. Reload/concurrency/error and billing checks PASS. `2d65873`. Live payment/portal polling remains untested. |
| L2 | partly | `bounded-fetch.ts`, songs/contact routes, 0010: deadline and streamed decompressed-byte limits for catalog/preview transfers; contact messages persist in cloud storage under an atomic five-per-hour HMAC-IP budget even when disk/email fail. Shared limiter concurrency and no-email/read-only-disk fixtures PASS. `f732b15`. Resend sender/recipient/delivery configuration is unverified, and pending inquiries need operational monitoring/manual delivery; no email was sent. |
| L3 | fixed | Updated stale account/billing/storage/runtime comments; root package and lockfile select Node 22.x. Final suites run under installed Node 22.23.4 without the former Node 20 warning. Plan file diff is comment-only. `c28ac56`. Deployed runtime selection still needs review. |

### Part 3 verification output

Final required checks and the additional scripts ran under Node 22.23.4. `review-checks` explicitly unset Supabase/R2 credentials and used NODE_ENV=test, so its local file tests could not select production storage. No `.env` file was loaded. SQL containers use postgres:16 already present locally, `--network none`, no host ports and fixture-only credentials. They are removed after tests. Readiness now checks container-loopback TCP, avoiding PostgreSQL's temporary initialization-server restart race.

```text
$ node --version
v22.23.4
$ npx tsc --noEmit -p .
[exit 0, no output]
$ npx eslint src render
[exit 0, no output or warnings]
$ node scripts/review-checks.cjs
PASS: sound migration, piece/gap timing, malformed sections, storage recovery/concurrency, byte ranges, coalesced saves, bounded filmstrip cleanup
$ node scripts/generation-checks.cjs
PASS: preserved edits/history, stale-input guard, no unreserved spend, server fallback/refund decisions, uncertain start, deterministic output, finalization retry, job-only API, authenticated recovery cron
$ node scripts/generation-sql-checks.cjs
PASS: migration replay, ownership, request replay, parallel quota, shared monthly window, leases, bound legacy/fal task IDs, one fallback/refund, completion CAS/replay, uncertain recovery, RPC grants
$ node scripts/billing-checks.cjs
PASS: lost Checkout response reuses persisted parameters/key, existing session reuse, old unknown-create recovery, busy lease, lookup fail closed, action CAS failure, webhook fresh state under lease, owner mismatch/signature guards, no paid imports
$ node scripts/billing-sql-checks.cjs
PASS: billing/deletion/upload/run/AI/export/contact migrations replay, leases/order/CAS, ownership, atomic merge/append, entitlement/rate limits, source changes, cleanup snapshots and service grants
$ node scripts/text-checks.cjs
PASS: valid CSS property names across all 50 styles and Webkit stroke/fill/clip
$ node scripts/deletion-checks.cjs
PASS: deletion cancellation/expiry ordering, no refund/proration, Stripe failure blocks auth deletion, grant wait, strict R2 retry, auth last, terminal replay
$ node scripts/billing-change-checks.cjs
PASS: declined upgrade leaves plan/schedule intact, immediate collected upgrade with retry key, downgrade/cycle switch at renewal, cancel/resume schedule clearing
$ node scripts/upload-checks.cjs
PASS: unreserved/foreign finish rejected, exact HEAD size/type, immutable conditional copy, finalized replay
$ node scripts/ai-checks.cjs
PASS: AI entitlement/rate failures, reserved snapshot/token, stale completion rejection
$ node scripts/auth-next-checks.cjs
PASS: shared same-origin auth destination rejects control characters and browser-normalized external paths
$ node scripts/render-checks.cjs
PASS: render spec count/time/size/identity bounds, decode dimension/duration limits and queue/byte budgets
$ node scripts/render-admission-checks.cjs
PASS: real worker HTTP auth, idempotent dispatch, changed-payload conflict, one active export per user and queue cap; all external fetches blocked
$ node scripts/export-checks.cjs
PASS: durable export recovers from output without worker/browser, owned registration, single append, bounded resumable PNG cleanup and terminal replay
$ node scripts/config-checks.cjs
PASS: every missing production auth/storage/accounting setting fails closed; development local mode retained
$ node scripts/budget-checks.cjs
PASS: isolated work deadline abort, unchanged Kling models/prompts, all function budgets <=300s and daily Hobby cron
$ node scripts/media-retention-checks.cjs
PASS: cloud asset removal only unlists assets; no capped reference scans or destructive media/R2 deletion
$ node scripts/settings-checks.cjs
PASS: settings reload deduplicates concurrent requests, uses deadlines and distinguishes transport failure from no subscription
$ node scripts/network-checks.cjs
PASS: streamed response cap/cancellation and deadline, bounded JSON response, contact survives read-only disk/email outage in durable storage
$ node scripts/provider-safety-checks.cjs
PASS: truncated MP4 v1 header is safe, unknown provider status and transient result failure never become paid fallbacks
$ node scripts/r2-signing-checks.cjs
PASS: offline upload signature binds Content-Length, avoids empty-body checksum and copies only the HEAD-verified object version
$ node --check render/server.mjs
[exit 0]
$ git diff --check
[exit 0]
```

Every listed command exited 0. Generation SQL emits expected replay notices and two caught Invalid provider task errors from negative assertions. The extended SQL suite applies each new migration twice and verifies authenticated has no execute privilege on any public mavya_* RPC. It additionally checks deletion write blocking, request survival after auth cascade, upload ownership/replay, parallel section merging, one export append, AI budgets/input CAS, concurrent contact admission and late deletion billing events. Node-only fixtures block unknown imports. The worker test uses only its own localhost HTTP service with all external fetches replaced before startup; no input reaches ffmpeg or a paid API in that test. The signing test uses real signing middleware with an HTTP handler that forbids network access.

No complete production build, live Stripe sandbox workflow, cloud R2 transfer, real generation or multi-browser visual export was run. No full-resolution load test or vendor cost measurement is implied by the passing fixtures. No prompts or model constants changed; the AST check compares Kling prompt/model definitions with `0b013a7`. Prices, plan counts and plan features are unchanged.

### Part 3 migrations to apply, in order

Apply after existing 0001-0005. Never edit/reapply 0001-0005 for this delivery, and do not replay older function definitions out of order after later migrations.

| Migration | Purpose |
| --- | --- |
| `0006_account_deletion.sql` | Durable deletion record without auth cascade, closing-account write triggers, deletion lease and billing-lock exclusion. |
| `0007_upload_reservations.sql` | Owned, expiring upload reservations and leased atomic registration; deletion captures pending canonical/staging identities and prioritizes the current subscription. |
| `0008_atomic_runs_ai.sql` | Atomic run section merge, idempotent export append, daily product/script budgets and latest-request/input CAS. |
| `0009_export_jobs.sql` | Durable export identity/payload/cleanup cursor, one active export per user, snapshot reservation, temporary PNG expiry and deletion capture. |
| `0010_contact_inquiries.sql` | Durable contact inbox with shared atomic hourly admission; no public read/write policy. |
| `0011_script_source_cas.sql` | Script completion also checks the locked current reference snapshot. |
| `0012_generation_temp_ownership.sql` | Owner/expiry ledger for new provider staging; deletion includes these keys and deterministic late generation outputs. |
| `0013_deletion_billing_events.sql` | Retained billing identities on deletion tombstones and transactional late-event handling without recreating auth-bound rows. |
| `0014_deletion_grant_grace.sql` | Adds a two-minute streaming grace after six-hour grants; adjusts unfinished deletion requests without shortening any existing wait. |

All new tables enable RLS and grant server access to service_role only; new callable RPCs revoke PUBLIC/anon/authenticated execution and grant service_role. Migrations are transaction-wrapped, use IF NOT EXISTS/replacement functions where appropriate, and pass ordered local replay. They do not delete the founder's runs or change prices/allowances. None were applied to production here.

### Part 3 environment, Stripe and rollout notes

- No new environment variables. Existing Supabase public settings/service-role key and all four R2 settings are mandatory for protected production routes. Existing FAL_KEY/GEMINI_API_KEY, Stripe settings, RENDER_URL/RENDER_SECRET and CRON_SECRET remain feature requirements. Secrets were not inspected or changed.
- Keep Hobby's once-daily `0 4 * * *` recovery schedule and supported function budgets. Node 22.x is now selected by package engines; verify the actual Vercel and render-service runtime selections when deploying. No hosting plan upgrade is assumed or performed.
- Stripe restricted keys need **Subscription Schedules create/read/update/release**, **Subscriptions cancel** as well as read/update, and **Checkout Sessions expire/read/create**. Upgrades use the subscription update API's immediate invoice/payment behavior, not separate invoice-pay/refund calls. Existing customer/invoice reads and payment-method portal permissions remain necessary. Verify these permissions and payment-decline/3DS cases in a separate authorized sandbox review before rollout; no live charge was used to validate them.
- Deploy the reviewed **render worker before the app**. `/health` must report protocol 2 and POST /jobs must retain the supplied idempotent job ID. The app now refuses dispatch to an older worker instead of repeatedly starting untracked renders. Keep the shared secret configured on both services.
- Apply all new migrations before enabling the new app routes. Plan a controlled cutover for old open Checkout links, in-flight jobs and old export clients; old base64 export requests are no longer accepted. Reload old tabs. This report is a review handoff, not authorization to deploy automatically.
- Verify browser-to-R2 CORS still permits the PUT/Content-Type flow and that signed Content-Length uploads plus ETag-conditional copy work in the actual bucket. HEAD/type/size and signatures are covered locally; live R2 behavior was not exercised. A bucket lifecycle policy for abandoned legacy tmp/ keys remains a useful independent backstop, but no policy was silently installed.
- Review `contact_inquiries.status='pending'` operationally. Messages are safely stored if Resend fails, but this commit does not implement automatic outbox delivery or establish that the configured sender/recipient works. CONTACT_FROM must be a verified sender for actual delivery; no test email was sent.

### Part 3 changes users can notice

- Outline/Hollow/Gradient export CSS is valid. Missing fonts, invisible non-empty text, missing PNGs and resource excess produce an error rather than a partly rendered video.
- Deletion cancels billing without refund/proration, blocks new work, and continues durably. Storage/auth removal waits at least six hours and two minutes, then cleanup runs. A failed cancellation retains the account and asks for another attempt/support. Multiple known subscriptions may need repeated bounded cancellation work before deletion can complete.
- Same-cycle upgrades collect the prorated difference now. Downgrades and monthly/yearly switches start at renewal; pending changes are shown in Billing and are cleared by cancel/resume. Failed payment shows "Payment failed. Update your card."
- Uploads expire and cannot be claimed by another user; finalized content is isolated from the replayable staging PUT. Export PNGs upload separately, so large text projects do not require a single base64 request.
- Export waits for successful saves and uses the saved snapshot. Reopening a run can resume its export. Render admission may ask users to wait when one export is active or the queue/resource budget is full. Export does not require the original browser to register a completed output.
- Product/script requests require entitlement, have the stated daily request budgets and reject stale results. Changing a run during a read/write may require retrying the AI request rather than applying an outdated result.
- Removing a file from My files no longer destroys its cloud media while another screen/project may use it. Canonical media remain until account deletion; this is a retention/cost tradeoff.
- Settings distinguish payment due and transport failure from no subscription. Contact inquiries can be retained despite email outage. Marketing copy, prices, plan features, general page styling and the founder's generation models/prompts remain unchanged.

### Part 3 remaining limits and risks

1. **M6 remains partly open.** True Glass/Dark glass backdrop blur needs video pixels under the text layer; a transparent isolated PNG cannot provide them. I did not change the preview style or choose a visual substitute. Filter ordering is aligned, but CSS and ffmpeg color implementations still need golden-pixel testing. Safari/Firefox/mobile, all 50 styles rendered as actual images, Google-font failure and a full-resolution export matrix are unverified.
2. **Hobby recovery has real capacity limits.** Daily cron advances one bounded category/job or cleanup batch per invocation, with deletion/expired temporary work before exports/generations. It is not a per-minute queue processor and cannot promise rapid unattended recovery or a strict cleanup SLA under backlog. An open/reopened run advances its own job; later upload requests also trigger expired-upload cleanup. Large deletions or many abandoned jobs can take multiple requests/days. Provider result expiry and a prolonged closed-browser backlog remain risks. Monitor these queues; moving to a stronger scheduler/hosting plan later is an explicit founder decision, not assumed here.
3. **Ambiguous provider acceptance remains manual.** Network loss or missing identity after submit never launches another paid video blindly. Reconcile uncertain jobs against fal request/spend records before binding a verified task or refunding. New ownership ledgers do not reconstruct old unrecorded task IDs or historical unowned tmp/gen objects. fal's documented queue lifecycle has IN_QUEUE, IN_PROGRESS and COMPLETED; an unknown response or transient result failure is retried as unavailable, not treated as a refusal. [Official queue lifecycle](https://fal.ai/docs/documentation/model-apis/inference/queue).
4. **Same-section edits remain last-writer-wins.** Atomic section merging prevents unrelated section loss. It is not full collaborative editing or an assurance that a stale browser's whole hook section cannot replace a newer hook section. Durable generation/export results remain separately recorded. AI CAS is conservative: any intervening saved run edit rejects completion, even if unrelated, and the request budget remains consumed.
5. **Advanced billing and real payments need review.** The implemented simple policy supports standard active one-item, quantity-one, automatic-charge subscriptions created by this product. Paused, trialing, multi-item, manual-invoice or advanced schedule configurations fail safely for support. Live restricted-key behavior, tax/discount combinations, 3DS, renewal webhooks, external portal edits, ambiguous payment responses and production API-version details were not exercised. A remote change can succeed while the local conditional write fails; reconciliation must then come from Stripe, not an assumed second charge. No duplicate-subscription refunds were introduced.
6. **Legacy and storage cleanup need operational cutover.** Already-issued old Checkout links and unowned old storage keys cannot be invalidated merely by adding these tables. Account cleanup snapshots all new owned identities before removing auth; old unindexed objects require a separate inventory/lifecycle review. Existing signed grants delay deletion. Batch failures retain cursor/ownership information. Contact inquiries and deletion tombstones retain necessary support/audit data; define and operate their retention policy separately.
7. **Active-account media retention costs storage.** The M9 policy prevents destructive reference races by retaining canonical media. It does not implement a transactional reference graph or reclaim every unreferenced object from an active account. Temporary export/provider data have bounded cleanup paths, but daily throughput can lag. Do not claim that removing My files instantly frees R2 storage.
8. **Worker bounds are code/tested, not capacity-certified.** The local HTTP test exercises admission with external I/O blocked; it is not a production memory/disk/CPU benchmark or a full-resolution ffmpeg run. The renderer needs sufficient disk/RAM for its admitted envelope. Worker restarts lose in-memory status, but the app's persistent output/job identity can recover or safely redispatch identical work. Resource rejection fails the whole export; text is not silently omitted.
9. **Delivery/deployment remain unverified.** No migrations, RLS, CORS, credentials, cron delivery, Node deployment settings, Resend delivery, cloud transfer or live end-to-end generation/payment/export was tested against production. All required and new local checks pass. Review the branch and these nine migrations before any merge/deployment.

Part 3 code is committed in finding-scoped commits on the existing branch. This report is committed separately for Claude's review. Nothing has been pushed or merged into main.
