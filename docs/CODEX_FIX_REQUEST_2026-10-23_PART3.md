# Codex fix request, part 3: finish the remaining findings (2026-10-23)

Part 2 reviewed and accepted by Claude (all suites pass, 0005 catch on fal task ids was right). Continue on
`codex/launch-fixes-2026-10-23` from its current head. Same ground rules as parts 1 and 2 (no push/merge, one commit
per finding or coupled group, new migrations `0006_*` and up, stubbed tests, all existing suites passing, no paid
calls, no price/limit/prompt/model/UI-style changes, short copy without em dashes).

**Please work through the whole list below in one session.** Stopping after each group costs the founder a full
review round every time. Only stop early for something you truly cannot do safely, and then still continue with the
*other* independent items (they do not depend on each other) before writing the report. A clean, smaller policy
that is fully correct beats a complete-but-risky one; where a product policy choice is needed, take the simple
option given here.

## Order

1. **H11 (live user-facing bug, small):** fix the vendor-prefix serializer in `src/lib/text-png.ts`
   (`WebkitTextStroke` -> `-webkit-text-stroke`, same for fill color / background clip) so Outline, Hollow and
   Gradient match the preview; a non-empty text that draws nothing is an export error, never silently dropped. Add a
   check that the serializer outputs valid property names for all 50 styles.
2. **H7 (delete account), simple policy:** record a deletion request row; cancel the Stripe subscription
   immediately (no refund, no proration) or stop with a clear error; block new generations/uploads/exports/checkouts
   for that user; delete their `media/<id>` R2 objects listed in `media`; then delete the auth user. Idempotent and
   resumable from the request row. Generation jobs already running may finish and be discarded.
3. **H5 (upgrades), simple policy:** **upgrades** charge the prorated difference immediately
   (`proration_behavior: "always_invoice"`, `payment_behavior: "error_if_incomplete"`) and the new plan applies only
   when that payment succeeds (if it fails, nothing changes and the user sees "Payment failed. Update your card.");
   **downgrades** and **monthly <-> yearly switches** take effect at the next renewal (Stripe subscription
   schedule, or store the pending change and apply it on the renewal webhook, whichever is simpler and testable).
   Cancel/resume clears a pending downgrade. No discounts logic beyond what Stripe does by default.
4. **H9** upload reservations (owner, mime, declared size, expiry; finish only by owner; HEAD size check and cap).
5. **H10** atomic run section merge in Postgres; exports appended idempotently by media id; product/script results
   applied only if their input still matches.
6. **M1** product/script routes: paid plan or admin, plus a per-user limit (e.g. 30 product reads and 60 scripts per
   day). **M4** client next-path check (reuse the callback's same-origin parse).
7. **H12 + M5** render server limits (input bytes/count/dimensions, queue cap, one job per user, wall-clock and
   subprocess deadlines, bounded stderr, streamed upload) and export finalization from any poll plus temp cleanup.
8. **M2 + M3** export save barrier on the saved run; text PNGs uploaded directly (not base64 in one request) and
   never silently dropped.
9. **M6, M7, M8, M9, L1, L2, L3** as in the review, in that order, as far as they go cleanly.

## Report

Append **Part 3** to `docs/CODEX_FIX_REPORT_2026-10-23.md` (same format), with new migrations in order, env/Stripe
settings, user-visible changes and risks. Then stop for Claude's review.
