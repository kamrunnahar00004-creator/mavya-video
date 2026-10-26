# Verification and whole-app audit, 2026-10-26

Branch: `codex/verify-2026-10-26`, from main `128ce42`. Reviewed `09f2d96`, `f4ee339` and context `cd655fe`, `79dad9b`, `b0dc253`, plus the current billing/auth/generation/export/storage/editor paths. No push, merge, deployment, real account creation, live Stripe call, paid generation, email or production database write. No .env or founder .data changes. All commits use the requested identity. No migrations added or edited.

The day's reported live payment, webhook replay, SMTP delivery and refund facts are inputs from the request, not tests repeated here. The fixes below address demonstrated failures. This is a code/local verification result, not production capacity or credential certification.

## B1. Checkout return

**Verdict: ordering/ownership design retained; deletion parity fixed; missing tests added. Commit `2824f3e`.**

- `src/app/checkout/return/route.ts:23` rejects a signed-out user before Stripe access, malformed session IDs, a different client_reference_id, incomplete/unpaid sessions and missing subscription identities. Both paid and no_payment_required are accepted, preserving coupon support. Metadata, when present, must match the authenticated account. A session ID alone does not grant access.
- Current Stripe subscription state is retrieved under the same account billing lease used by webhooks. `mavya_billing_event` performs the owner binding check and writes billing_subscription_ids; it does not rely only on metadata. The subscription ID cannot be rebound to another owner through this route.
- Session creation time is intentionally conservative. A larger last_event_created wins: the return RPC cannot overwrite it. Equal-second reconciliation retrieves current Stripe state under serialization. A repeated checkout-return:<session id> is duplicate and does not reapply state. A later delivered webhook is not necessarily a newer event, but a genuinely newer event watermark cannot be lowered. Stripe does not guarantee delivery order; see [Stripe webhook ordering](https://docs.stripe.com/webhooks#event-ordering).
- Added actual PostgreSQL assertions for an old checkout-return event after a newer cancellation, duplicate replay and retained subscription ownership. Existing tests cover ordered/equal-second reconciliation, revision CAS, rollback, foreign owner and competing subscription conflicts. These pass.
- **Medium, fixed:** the old return path did not use the deletion-tombstone lifecycle. The billing lock usually failed closed for a closing account, so this was not an established account-resurrection exploit, but a paid late subscription did not get the return route's explicit cancellation reconciliation. The route now checks account_deletions by user UUID, verifies any subscription binding, records mavya_deletion_event and advances cancellation instead of applying an ordinary plan. A new Google/email account with a new UUID does not inherit an old email's tombstone or admin privilege. A deletion beginning in the small pre-lock race still makes the normal lock fail closed; webhook/cron recovery remains necessary.
- The route budget increased from 60 to 120 seconds to cover added bounded lookups and normal reconciliation. This does not change the 300-second ceiling or promise immunity to all upstream stalls.
- New `verify-checkout-return.cjs` executes the actual handler with service stubs: signed out, bad ID, foreign session, incomplete session, unpaid session, no subscription, success, no-payment-required, missing/foreign metadata, replay, older result, conflict, Stripe error, deletion handling, foreign deletion binding and a newly created account UUID. No real Checkout is created or retrieved.
- Conflict and exceptions still go to `/settings/billing?paid=1`. Billing's existing 30-second confirmation loop, successful Refresh after timeout and usable-allowance-to-studio navigation pass the auth/billing fixtures. A canceled or still-unusable subscription can be redirected from studio by the gate even after a duplicate/older return result; the return URL is not unconditional entitlement.

## B2. Silent webhook failure

**Verdict: fixed cheap diagnostics and shape validation. Commit `fba0567`.**

- `src/app/api/stripe/webhook/route.ts:13` now logs `stripe_webhook_config_invalid` for missing/malformed signing configuration and `stripe_webhook_signature_invalid` for signature verification failure. Responses stay 503 and 400 respectively. The log omits secret, signature, raw request body and exception text that might contain them.
- `src/lib/production-config.ts` adds stripeWebhookSecret: trim outer whitespace, require whsec_ plus a nonempty whitespace-free suffix. This is billing-specific; productionReady does not make unrelated app routes unavailable because Stripe is misconfigured.
- Shape validation cannot prove that a syntactically valid secret belongs to this endpoint. The original incident's wrong whsec_ value would still need signature verification to detect it. The new distinct marker makes that failure observable; it does not repair dashboard configuration.
- Config tests cover missing, empty, wrong-prefix, empty-suffix, internal-whitespace and trimmed-valid values. Handler tests verify alert markers and that sensitive exception detail is not logged. All pass.
- No failure-counter table or production alert was installed. That would add public unauthenticated writes or require access to the founder's logging system. **Operational action:** alert on the two markers in the chosen log system, monitor webhook 4xx/5xx and Stripe delivery failures, and keep a saved query/runbook. An identifiable log without an alert subscription is still not a notification to the founder.

## B3. Permanently unowned subscription events

**Verdict: fixed. Commit `85e1005`.**

- `src/app/api/stripe/webhook/route.ts`, after all owner lookups: if subscription binding, deleted-subscription binding, current Stripe metadata, customer subscription lookup and deleted-customer lookup all succeeded and found no owner, log `stripe_webhook_owner_unresolved` with event/subscription IDs and return 200 with result unowned.
- Database errors, Stripe retrieve errors, ambiguous ownership and reconciliation errors still return 500. They do not become successful event acknowledgements. This distinction prevents the old Etsy-style definitively unowned subscription from retrying forever without suppressing transient failures.
- The new fixture tests both transient DB/Stripe errors and the fully resolved no-owner outcome. Existing mismatch, closing-account and billing-event tests pass. Unowned events are recorded in logs, not a new durable SQL table; log retention and review remain operational requirements. No unknown subscription is automatically canceled, attached or refunded.
- This does not magically resolve a bogus nonempty metadata user ID that has neither a live account nor a tombstone; an ensuing lookup/transaction failure still requires investigation rather than guessing ownership.

## B4. Forgot/reset password

**Verdict: core flow correct; callback and transport-failure edge cases fixed. Commit `5b03c70`.**

- `src/app/auth/callback/route.ts:19`: token_hash uses verifyOtp with recovery type, while code uses exchangeCodeForSession. Recovery next/type bypasses auth/continue and reaches reset-password. Google still goes through auth/continue with safeNext.
- **Medium, fixed:** a token_hash without type was verified as recovery but could then go through normal continuation. It now always selects reset routing, matching the verification type. Thrown callback transport/client errors now follow the existing failure redirect instead of escaping as an unhandled 500. Token_hash and code error fixtures pass, including expired links and unchanged Google continuation.
- `src/components/auth-modal.tsx:63` focuses the email input when mode changes. Forgot send uses a generic sent response for success, unknown account and ordinary errors; only status 429 differs. Thrown transport errors previously left loading stuck and an unhandled promise; finally now resets loading while preserving non-enumeration. Tests cover send, generic failure, throw, 429, sent state and return to Login. The same text is not proof of equal network timing or protection against all account enumeration: ordinary signup/login have their own existing-email behavior by explicit founder policy.
- `src/components/reset-password-form.tsx:29`: short passwords and mismatch are rejected locally; same_password retains its specific message. Thrown update errors no longer leave the form permanently disabled. Expired/401 sessions select the expired screen. Success still loads auth/continue?next=/studio, so an unpaid account cannot use reset as a paid-gate bypass.
- `/reset-password` remains outside the proxy matcher. The browser SDK reads/refreshes its session and getUser validates it. The reset callback can write the cookie without proxy refresh. The local browser expired-screen check and stub ready/expired/save paths passed. Real SMTP/cross-device cookies were not exercised here.
- **Password-change policy recommendation:** enable Supabase's recent-login/secure-password-change protection after a sandbox recovery test, keeping confirmation email off. Supabase documents a 24-hour recent-session threshold and nonce reauthentication for older sessions. Do not add an old-password requirement to the emailed recovery form. No dashboard setting was changed; turning it on without checking the hosted recovery behavior and ordinary old-session reauthentication UX would be an incomplete rollout. [Supabase password security](https://supabase.com/docs/guides/auth/password-security). Current signed-in sessions can set a password as described in the request; this review did not invent a separate recovery-only authorization model.

## B5. Contact sender

**Verdict: fixed. Commit `85b4d73`.**

- `src/app/api/contact/route.ts:66` defaults to `Mavya <no-reply@mavya.app>`, preserving CONTACT_FROM override, CONTACT_TO and sender reply_to.
- network-checks captures the actual email request body with an offline transport and verifies the new default, override and reply address. No email was sent. Durable inquiry storage, bounded response reads and email-outage survival remain intact.
- The verified-domain/SMTP facts in the request are not a new delivery test. Contact API email uses RESEND_API_KEY, while Supabase recovery SMTP is configured separately; one working does not certify the other.

## B6. General sweep and execution evidence

**Verdict: all required local checks pass. Additional verification commit `4139fec`.**

```text
Node 22.23.4
21 scripts/*-checks.cjs             PASS
5 scripts/verify-*.cjs              PASS
npx tsc --noEmit                    PASS
npx eslint src render               PASS, no warnings
npx next build                      PASS, 34 pages generated
git diff --check                    PASS
```

All suites were run on the final functional changes; the final direct-upload cleanup refinement was followed by its affected retention/review checks, typecheck, lint and a rebuilt production artifact. New ordering, route-gate and cron assertions were also rerun. Expected PostgreSQL rejection fixtures print Invalid provider task while testing invalid identities; the suites exit successfully. No unresolved failing check was hidden.

The build ran in a separate physical copy of tracked source/dependencies with no actual .env/.data, preserving the founder's running .next. No real provider credentials were loaded into the audit server. Cloud variables are unset for the local JSON review fixture. SQL checks use disposable network-disabled PostgreSQL 16 containers, removed afterward. Paid/external service calls in tests are explicit stubs.

Browser checks used a separate headless Chrome profile with mute-audio and autoplay restrictions against the isolated local production build. No audio playback. Windows Node drives CDP; application checks/build use Node 22. Public Google font download for the text check is unpaid. No authenticated production browser session was used.

## B7. Whole-app audit

### High findings fixed

**B7H1. Unpaid users could create stored content and save Deezer previews into R2. Fixed, `26c6d2c`.**

- Evidence: `src/app/api/songs/[id]/route.ts:23`, `src/app/api/runs/route.ts:18`, `src/app/api/references/route.ts:27`, `src/lib/supabase/session.ts:51`.
- Failure: a signed-in unpaid account could POST a song ID, causing a download and saveMedia R2 write, or repeatedly create/patch runs/references despite being blocked from app pages. The old paid regex covered upload/media/export only.
- Reproduce: send POST /api/songs/123 or POST /api/runs while allowance has no plan. The previous gate permitted the handler; song save performs the external download and object write.
- Fix: paid checks for POST/PATCH song saves and root/individual runs/references content writes. Reads and deletions keep their existing ownership controls; Settings/account support remains available. AI routes retain their transactional admission instead of being replaced with a proxy-only check. Public contact remains its bounded deliberate business-inquiry exception.
- Verification: actual gate tests reject these writes with 402 unpaid/past_due and permit paid/admin to reach handler validation. New route inventory executes all 34 exported API methods against five personas, 170 gate decisions.

**B7H2. Missing source video silently selected a different paid generation path. Fixed, `26200fe`.**

- Evidence: `src/lib/server/hookgen.ts:194`, `src/lib/server/store.ts` libraryFile/mediaToFile, and R2 downloadTo.
- Failure: a missing/unreadable reference or an R2 outage could make hookVideo return null for a library/upload request. startHook then entered the described text/image path and submitted a paid job unrelated to the requested motion reference.
- Reproduce: stub libraryFile and mediaToFile to return null for a selected library/upload source. Previously execution could proceed to a described fal submission. The regression now rejects before submission.
- Fix: require an available clip whenever an existing reference or explicit library/upload source is requested. Deterministic failure follows the existing single-fallback/refund policy. Described hooks still use the same approved models, constants and prompts. No generated-output ffmpeg processing added.

**B7H3. Direct server media writes could escape deletion's ownership snapshot. Fixed, `f6d4642`, refinement `b6416c9`.**

- Evidence: `src/lib/server/store.ts:245`, saveMedia used by direct media uploads and saved songs.
- Failure: R2 PUT preceded media registration. If account deletion acquired its snapshot before registration, the closing-account trigger rejected the later DB insert while the random object already existed outside that snapshot. This differs from upload reservations and deterministic generated/export IDs, which were already tracked.
- Reproduce: allow R2 PUT, then reject registerMedia as Account deletion in progress. The old order left a successfully written object without an ownership record.
- Fix: record media ownership first, under the existing closing-account trigger, then PUT. Deletion either blocks the write before object creation or snapshots the identity before waiting for in-flight grants. Preserve ownership on ambiguous PUT failure, and unlist failed asset uploads so My files does not display a phantom success. No uncertain object is made unowned by deleting its media ledger.
- Tests prove registration-before-PUT, no PUT on deletion rejection, retained ownership after an ambiguous PUT failure, and removal of the failed asset listing only. No R2 mutation used.

No additional confirmed blocker was found. The following medium/low defects and operational limits are explicitly not called fixed.

### Medium / low findings remaining

| ID / severity | File:line and concrete scenario | Verdict / smallest next step |
| --- | --- | --- |
| M1 Medium: Pricing horizontal overflow | `src/components/pricing-page.tsx:353`. At a 375 px viewport, document clientWidth=360 and scrollWidth=380; at 320 px, clientWidth=305 and scrollWidth=325. Hiding only the decorative -inset-10 glow in the local DOM restores scrollWidth=clientWidth; the comparison table remains correctly inside its own scroll container | Not fixed, listed per instruction to fix highs and list the rest. Bound the decorative glow without changing the card layout; no repo styling edit made |
| M2 Medium: editor/worker bound mismatch | `src/lib/server/run-validation.ts:19`, `render/limits.mjs:23`. Actual fixture: 201 keyframes pass validRunPatch but fail validJob; up to 100 demo clips are accepted while worker permits 40 segments. A valid saved project can reserve an export that the worker rejects repeatedly | Not fixed. Share preflight bounds at export admission and return a concrete error before reserving/rendering; do not silently drop clips/keyframes |
| M3 Medium: retention promise differs from runtime | `src/app/privacy/page.tsx:37`, How long we keep it; `src/lib/server/store.ts` deleteAsset/deleteMediaFile. Remove a cloud file from My files: the asset disappears but owned canonical media remains until account deletion, intentionally avoiding destructive reference races | Not fixed, needs founder decision: align the disclosure with safe retention or approve a real reference-aware reclamation design. No privacy copy or deletion policy silently changed |
| M4 Medium: profile read outage becomes empty profile | `src/app/api/profile/route.ts:30`. A profiles select error is ignored; GET returns email plus empty names/avatar as if that were saved data. A user can then edit based on a false empty state | Not fixed. Propagate read failure as unavailable and preserve prior successful UI data |
| M5 Medium: some delete errors report success | `src/lib/server/store.ts:227`, also cloud deleteReference/deleteAsset. Supabase delete resolves with an error field instead of throwing; these helpers ignore it, and the route can return 204. Reload then restores the supposedly deleted item | Not fixed. Check query errors before acknowledging deletion; account-deletion's strict durable cleanup is a different path and does check errors |
| M6 Low: large histories are truncated without paging | `src/lib/server/store.ts:99`, `:166`, `:280`. Library/run/asset lists have fixed limits 5000/1000/2000 and no continuation. The 1001st older run can disappear from the listing while still owned; project API row caps may be lower | Not fixed. Add pagination/summaries rather than increasing full-object response limits |
| M7 Medium: indefinite unusable provider results | `src/lib/server/hookgen.ts:276`, `src/lib/server/generation-jobs.ts:103`. Repeated successful-but-incomplete output or unmeasurable video keeps releasing/retrying the paid task without an age policy | Not fixed, needs founder decision for support/escalation/settlement. Do not guess a duration, automatically respend or refund an unknown successful result |
| M8 Medium: advertised capability exceeds verified implementation | `src/lib/plans.ts:35` and `:46` / Pricing features vs `src/lib/server/ai-budget.ts` / `0008_atomic_runs_ai.sql`. Scripts are advertised Unlimited while admission is 60 script requests/day; Priority generation has no plan-specific queue priority in the reviewed generation code | Not fixed, needs founder decision on disclosure/fulfillment. Team reviews/consultancy may be manual services, not app features; their fulfillment was not verified. Prices/limits unchanged |

These are code/fixture observations, not new legal advice or a production load measurement. M1 was visually measured; M2 was reproduced with both actual validators; the other scenarios follow the identified code branches and existing focused tests where named.

### Feature coverage and boundaries

| Feature | Walkthrough / evidence / result |
| --- | --- |
| Landing, Pricing, Terms, Privacy | Public routes render from the isolated production build. Header/footer link targets inspected: /, /pricing, /terms, /privacy, /#how, /#faq and auth queries. Terms/Privacy/expired reset fit 320 px. Landing fits tested 375 px; Pricing has M1. No styling changes |
| Signup/login/Google/logout/next | Actual modal/host, auth-error, safeNext and callback fixtures pass. Email signup immediate; unknown credentials error; Google one door unchanged; signed-in popup loads continuation. signOut requests browser auth signout and fully reloads /. No confirmation flow added; backend signup settings and actual logout cookies were not changed/tested live |
| Admin and deleted/recreated identity | Both proxy and server admin checks now use ADMIN_USER_IDS, never email. Existing regression shows same email with a different ID gets no admin bypass. Deletion lookup is UUID-bound; a newly signed-up UUID is distinct even with the old email. Live ID configuration remains uninspected |
| Studio hook/product/script | Saved source/reference snapshot, owned run lookup and transactional AI/generation admission reviewed. Product/script have 30/60 daily budgets, latest-token/input/source CAS. Generation lease, task format, fallback, refund and cap fixtures pass. B7H2 fixes wrong-source fallback. Real prompt/model quality is untested and unchanged |
| Editor/clip list/trim/split/save | Reviewed run-view/edit/client/save queue and validation paths. Existing review checks exercise piece/gap timing, malformed sections, coalesced saves, local atomic storage and bounded filmstrip cleanup. SQL section merge/export append/AI CAS pass. Same-section stale-browser writes remain last-writer-wins; not collaborative editing. M2 covers allowed-but-unrenderable projects. This was not a full authenticated browser click matrix |
| Text | All 48 current style presets produced nonempty actual canvas PNGs in muted headless Chrome with Arial. One actual TikTok Sans export fetched/embedded the public font and produced pixels. Retired box-glass/box-dark resolve to Box, confirmed in browser and source. Existing CSS/property/subset/font-retry fixtures pass. No Glass style restored. Safari/mobile browser pixel parity remains untested |
| Music | Catalog search/top/trending reads are bounded and cached; POST saves only a 30-second preview with bounded download. B7H1 gates that write. No music played. The code performs no music-rights/license lookup; the marketing Music you can post wording is not independently licensed/cleared by this audit |
| Library | Owner-or-curated queries, category/search client filtering, owned/shared media access and signed links reviewed. Lists are bounded but unpaginated (M6). Browser media permission and expiry are covered by source/signing fixtures, not a live bucket stream |
| Uploads/My files/media | Type/size/owner/expiry/HEAD/ETag checks and immutable final copy pass. Reservation signed PUT is 15 minutes, max declared file 300 MiB; export PNG cap 3 MB. Failed/abandoned reservations are batched for cleanup. B7H3 fixes untracked direct PUTs; asset unlisting deliberately retains canonical ownership. MIME is declared/HEAD-checked, not a comprehensive content scanner |
| Export | Durable spec/job/output identity, saved snapshot and complete PNG manifest reviewed. Protocol 3 and fixed 720x1280 worker admission pass. Real offline ffmpeg tests verify start, 30.30 fps piece-boundary and end overlays, inactive intervals, 12 simultaneous overlays, 60 output frames and two-second nonzero audio data. No playback or real render service call |
| Export failures/download | Output-first recovery survives lost worker RAM; identical job replay and different-payload rejection pass. Remote errors keep retryable jobs; dead/slow worker can show Exporting/low progress, then the client's roughly 400-poll loop asks to reopen. Server expiry is six hours. Worker validation errors can also stay in that retry path (M2). Download resolves owned media and attachment filename via a signed GET |
| Billing all plans/cycles | Six configured plan/cycle price mappings remain unchanged and use the shared Checkout path with promotion codes. Existing fixtures exercise stable Checkout key/parameters, reuse, payment decline, collected same-cycle upgrade, renewal-time downgrade/cycle switch, pending schedule clear, cancel/resume and stale action CAS. Portal card update and invoice reads reviewed; actual sandbox tax/discount/3DS/renewal flows not run |
| Billing/Plans/Usage | UI uses API usage from mavya_allowance; annual monthly-anniversary and status/period/cancel-at-end SQL tests pass. past_due has Billing entry and cannot start another Checkout. New return route provides early reconciliation, while Billing still recovers delayed webhook confirmation. No price/quota policy edits |
| Settings/profile/account deletion | Settings remains open unpaid. Profile names/avatar validation, self-RLS and account DELETE reviewed, with M4/M5 caveats. Durable deletion cancels subscriptions without refund/proration, captures media/pending work, waits grant grace, strictly deletes R2 in batches, then removes auth. Late billing tombstones and new-user identity tests pass. No real deletion performed |
| Cron | Secret requires at least 32 characters and timing-safe bearer comparison. Five categories rotate by minute; grant-wait deletions are skipped. Fixture proves a slow failed first step prevents another start after 30 seconds. Leases handle overlap. A start window is not a shared cancellation deadline: pathological long individual steps/SDK retries/settlement can still exceed estimates. Actual delivery, queue throughput and maximum latency remain unverified |
| Contact | Email/message validation, honeypot, local and SQL shared five/hour IP budget, HMAC IP storage, durable inquiry and bounded email transfer reviewed/tested. Failure can leave status pending with a successful submission response; no automatic resend outbox exists. Monitor pending inquiries and logs. B5 changes the default sender only |

### Every app page: gate behavior

Signed out is redirected to the landing auth popup with next. Signed-in unpaid users are redirected to Pricing for studio/library/login, while Settings and the /billing alias stay open. Paid and admin users reach the page; /login redirects to studio. These are gate outcomes, not unconditional handler/data success. Past_due is treated as no usable plan at the app gate, then continuation/Pricing supplies the Billing recovery path.

| Page(s) | Unpaid / past_due | Paid / admin |
| --- | --- | --- |
| /studio, /studio/[id], /studio/[id]/edit | Pricing | Page |
| /library, /library/[id] | Pricing | Page |
| /login | Pricing | Studio |
| /settings, /settings/plans, /settings/billing, /settings/usage | Page | Page |
| /billing | Settings > Billing redirect | Same |

/, /pricing, /terms, /privacy and /reset-password are public pages outside that app gate. /auth/callback and /auth/continue validate their own sessions/tokens and sanitize redirects. /checkout/return validates its own user/session because it is outside the proxy matcher. A signed-out invalid reset cannot unlock any app page. Client-prefetch/RSC requests receive the same proxy decision; a page already cached in a paid tab is not instant UI revocation after expiry.

### Every API route: gate and handler behavior

Legend: **pass** means the proxy permits the request; normal body validation, ownership, status and transient errors still apply. All private routes return 401 signed out. **own** means owned resource only, generally 404 for foreign/missing IDs; deleting an absent/foreign item may be an idempotent 204. **AI** means server reservation/allowance policy, 402 for no plan and 429 for rate/quota-related admission as implemented. These distinctions prevent reporting a proxy pass as a tested end-to-end 200.

| API route / methods | Signed out | Unpaid | Paid | past_due | Admin |
| --- | --- | --- | --- | --- | --- |
| /api/account DELETE | 401 | pass, own deletion 202/503 | same | same | same |
| /api/assets GET | 401 | pass, own list | same | same | same |
| /api/assets/[id] DELETE | 401 | pass, own/idempotent | same | same | same |
| /api/billing GET, POST | 401 | pass, Checkout/Portal/state validation | pass, plan actions | pass, recovery; no duplicate Checkout | pass, normal billing rules |
| /api/contact POST | public validation/rate | same | same | same | same |
| /api/internal/generations GET | own CRON auth 401/200/503 | same | same | same | same |
| /api/media POST | 401 | 402 | pass, upload validation | 402 | pass |
| /api/media/[id] GET | 401 | pass, own/shared 302 or 404 | same | same | same ownership |
| /api/profile GET, PATCH | 401 | pass, own RLS | same | same | same |
| /api/references GET | 401 | pass, own/curated list | same | same | same |
| /api/references POST | 401 | 402 | pass, owned input required | 402 | pass |
| /api/references/[id] GET, DELETE | 401 | pass, own/curator restrictions | same | same | same curator restrictions |
| /api/references/[id] PATCH | 401 | 402 | pass, own/curator restrictions | 402 | pass, same restrictions |
| /api/runs GET | 401 | pass, own list | same | same | same |
| /api/runs POST | 401 | 402 | pass, 201 | 402 | pass |
| /api/runs/[id] GET, DELETE | 401 | pass, own/idempotent | same | same | same |
| /api/runs/[id] PATCH | 401 | 402 | pass, body/owner validation | 402 | pass |
| /api/runs/[id]/generate GET | 401 | pass, owned existing job recovery | same | same | same |
| /api/runs/[id]/generate POST | 401 | AI | AI/quota/cap | AI | checked ID bypasses plan/cap |
| /api/runs/[id]/product POST | 401 | AI | AI/daily budget | AI | entitlement bypass, daily budget retained |
| /api/runs/[id]/product DELETE | 401 | pass, own | same | same | same |
| /api/runs/[id]/script POST | 401 | AI | AI/daily budget | AI | entitlement bypass, daily budget retained |
| /api/runs/[id]/export GET, POST | 401 | 402 | pass, owned job/spec | 402 | pass |
| /api/songs GET | 401 via proxy | pass, bounded catalog | same | same | same |
| /api/songs/[id] POST | 401 | 402 | pass, bounded save | 402 | pass |
| /api/sounds/[code] GET | 401 | pass, validated shared library audio | same | same | same |
| /api/stripe/webhook POST | own signature/config 400/503 or verified processing | same | same | same | same |
| /api/uploads POST | 401 | 402 | pass, reserved upload protocol | 402 | pass |
| /api/usage GET | 401 | pass, allowance/period | same | pass, plan null/status due | pass, admin allowance |

The route inventory tests all 34 actual exported API methods against five personas (170 decisions). Handler-specific ownership/SQL/validation assertions reside in the focused suites; this table does not claim every possible request body was fuzzed. Closing accounts are additionally blocked by currentUser/account-state and database triggers on protected writes. Public contact's bounded mail/storage, account/profile support, existing accepted-job recovery and data deletion are intentional exceptions to a literal ban on every unpaid database operation.

### Security, RLS and failure modes

- Applied all 14 existing migrations together to a fresh isolated PostgreSQL fixture. All 19 public tables have RLS enabled: account_deletions, ai_daily_usage, assets, billing_checkouts, billing_conflicts, billing_events, billing_locks, billing_subscription_ids, contact_inquiries, export_jobs, generations, library, media, profiles, run_ai_requests, runs, subscriptions, temporary_objects, upload_reservations.
- Only profiles has authenticated own-read/own-update policies. Browser app code uses Supabase Auth, not direct application-table queries; profile table access is request-bound server code under RLS, other application data uses server-owned APIs/service clients. Callable mavya RPCs deny anon/authenticated execute and grant service_role; trigger-only helpers are not direct application RPCs.
- Owner filters and RPC tests protect runs, media, assets, exports and generations; curated library content is deliberately shared. Media playback permits curated/shared media. Admin does not grant arbitrary cross-user media access. Profile avatar URLs are shape-validated but not ownership-validated; a foreign private avatar reference fails playback rather than granting access.
- No service-role environment identifier appeared in generated client chunks, and source imports keep those clients/server fetches out of client components. This audits the local build/source graph, not the unknown production artifact or actual secret values. No secret was read into test output. API provider errors generally return short generic errors; signature/config logs avoid sensitive request material.
- safeNext rejects external/protocol-relative/control/backslash targets before URL normalization. Checkout and recovery redirects use fixed internal destinations. Bodies use route-specific validation rather than a universal schema: run/reference/clip/text bounds, ID formats, enum checks, reservation ownership and MIME/size/ETag checks were reviewed. M2/M4/M5 identify actual remaining inconsistencies instead of claiming exhaustive input safety.
- CURATOR=1 is a server-wide curation capability intended for the curator's machine. Do not deploy it indiscriminately to a public multi-user server: the reviewed curator branches check that flag, not an individual admin role. Production flag value was not inspected.

| Missing/wrong setting | Current failure behavior / limits |
| --- | --- |
| Supabase URL/anon/service key or R2 required setting missing | production-config rejects protected routes with 503; local .data is development-only. Public marketing can render. Actual invalid-but-nonempty credentials are discovered on use, not by presence validation |
| Supabase wrong/unreachable | allowance gate fails closed as Pricing/402; billing lookups return unavailable/500 for webhook retry. Some generic GETs can produce a framework 500; profile read error handling remains M4 |
| STRIPE_SECRET_KEY missing/wrong | Checkout/Billing unavailable; return route falls back. A missing API key can also be caught as signature verification failure by the existing construction path; the distinct config helper validates the signing secret, not all Stripe connectivity |
| STRIPE_WEBHOOK_SECRET absent/malformed/wrong | malformed -> 503/config marker; valid-looking wrong endpoint secret -> 400/signature marker. Shape check cannot establish matching endpoint ownership |
| One of six price IDs missing/wrong | Checkout/change fails with generic billing error or price mapping produces no usable plan; no substitute price is chosen. Sandbox/provider validation not performed |
| FAL_KEY/GEMINI_API_KEY absent/wrong | known setup/provider failure uses existing fallback/refund; acceptance ambiguity retains uncertain state. Some preparation can precede discovering a bad fal key; preflight/circuit breaking remains an improvement. B7H2 prevents missing-reference wrong-model spend |
| R2 credentials/bucket wrong | uploads fail; export recovery retries; playback signed URL fails at bucket; source download can return null, now explicitly refused for motion generation. No local production fallback |
| RENDER_URL/RENDER_SECRET absent/wrong or wrong protocol | absent configuration refuses export start; dispatch/auth/protocol failures keep durable retryable work. Client may show Exporting until timeout/reopen; no immediate health-specific user diagnosis. M2 can enter the same retry path |
| CRON_SECRET absent/short/wrong | 401 before recovery queries |
| RESEND_API_KEY/CONTACT_TO absent or delivery fails | inquiry still persists with pending status; no automatic outbound retry. Invalid recovery SMTP is a separate Supabase configuration failure, with generic forgot response by design |
| ADMIN_USER_IDS absent/stale | no admin bypass; matching email has no effect. Recreating an admin account changes its UUID and requires an explicit trusted ID configuration update |

### Performance and capacity

- Local muted Chrome landing sample: DOMContentLoaded about 197 ms and load about 583 ms; initial transferred script bytes about 237 kB. These are local Windows-to-WSL timings, not production geographic latency or Core Web Vitals. Largest generated raw client chunks were about 259, 230, 191 and 163 kB. No authenticated Studio load benchmark was possible without a fixture auth environment or real account.
- Studio fetches a full run plus a full library list. Library carries analysis/recipe/history fields; fixed list caps avoid infinite reads but are not paging or small summaries. Large histories, base64 thumbnails and overly broad client bundles can dominate load well before those caps. Missing continuation is M6. No speculative UI rewrite or dependency cleanup performed; @runwayml/sdk remains an installed unused runtime dependency, with no source runtime import found.
- Hot user-created indexes exist for runs/assets/generations, media ownership, library ownership and request identity/recovery. Refund-count queries use refunded_at but only the older user/created index; temporary-object/upload expiry and export/deletion recovery predicates lack ideal covering indexes for scale. Consider measured partial indexes on those queues, not blind global indexing; no production EXPLAIN or index migration was run.
- Renderer admission caps queue=8, one active job/user, file/job bytes, dimensions, decoded overlay area, process deadlines and total job duration. Those checks and local HTTP tests pass. A 12-layer two-second render is not certification that 200 layers/180 seconds fits the deployed RAM/CPU/disk envelope. Looped PNGs add decoder/filter buffers beyond the summed pixel budget.
- Cron rotates categories and processes bounded batches, but cleanup at five items per turn can lag a large backlog. Missing provider-result age policy, manual uncertain resolution, active-account canonical retention and pending contact outbox monitoring remain operating obligations. The 10-refund limit is a rolling app-level query outside reservation, so concurrent accepted work can overshoot it; this accepted limit was not silently converted into a new plan policy.

## Handoff

All demonstrated high findings found in this pass have fixes and focused offline checks. Medium/low items are listed with concrete scenarios; retained policy questions are labeled rather than silently changed. No live Stripe webhook resend, refund, account deletion, fal/Gemini request, SMTP send or hosted render was performed.

No new migrations or environment variables required. Deploy only after reviewing the branch; configure operational alerts for the three webhook markers and review pending contact/deletion/conflict/uncertain records. Keep the verified SMTP/template configuration, Node 22, protocol-3 worker and minute Pro cron. The generated-hook models/prompts, fixed prices/allowances, no-confirmation rule, Google door, ID-based admin rule, no Glass and TikTok Sans default remain intact.

Production auth/Stripe/R2 configuration, geographic latency, real generation output quality, rights to posted music, real worker load and complete authenticated browser feature interactions remain unverified. Local tests and code traversal do not turn these into verified production claims.
