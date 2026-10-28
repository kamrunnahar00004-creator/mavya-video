# Codex request: make the library fast again, safely (2026-10-28)

Follow-up to docs/CODEX_BRUTAL_REVIEW_REPORT_2026-10-28.md (merged to main as e1f0d51).

## Problem

Your review correctly removed the account-agnostic module cache in src/lib/library-cache.ts. The cost is in your own table: "Videos to library" usable went 1094.7 ms -> 2320.1 ms. The Viral library is the founder's most visible page and slow library loading was the original complaint. Click feedback is now good; content arrival is the remaining problem.

## Goals

1. **Library content fast on every visit, with no cross-account leak.**
   - The curated catalog (owner = "curated") is identical for every user. Find the safest fast path for it. Options to evaluate, pick one with evidence:
     - a separate curated-only request whose response holds no owned data, cached client-side (module or sessionStorage) and/or with a private browser cache header;
     - a server-side cache of the curated projection (e.g. `unstable_cache`/`"use cache"` with a tag, invalidated when curated rows change), with signed cover URLs minted per request or with a lifetime safely inside the cache window;
     - anything better you find.
   - Owned references stay fresh per request (or are cached only with explicit identity scope + invalidation on sign-out, upload, edit, delete).
   - Any cache must be invalidated or bypassed after curator edits within a bounded, stated time.
2. **Smaller and cheaper catalog payload.** Your remaining finding 2: the DB projection reads the full recipe and analysis before the studio trim. Project only the fields the studio/library cards need at the database level (Postgres JSON path selection or a view/RPC; a migration is allowed if needed, but write it to supabase/migrations and do NOT apply it; the founder applies migrations). Measure bytes before/after.
3. **Library to videos above 100 ms** (your open item, median 103.1, max 105.5). Find the cause and fix it if possible.
4. Prefer render cost reductions where the full 2,000-item window renders at once (virtualize or render progressively only if measurements show a real long task).

## Rules

- No paid plan cache or entitlement cookie (your decision stands).
- Keep getUser identity checks (your F8 stands).
- No new env vars unless unavoidable; say so if needed.
- Prices, plans, auth rules, fonts, text presets unchanged. No em dashes in any UI copy. No new helper/filler UI text.
- No real fal, Gemini, Stripe, email, or R2 writes. No founder .env or .data changes.
- New branch from main. Commit as kamrunnahar00004-creator. Do not push or merge.

## Report

Write docs/CODEX_LIBRARY_SPEED_REPORT_2026-10-28.md: chosen approach and why, leak analysis (who can see what, worst-case staleness), before/after table using the same protocol as the brutal review (videos to library, library first visit, library repeat visit, open video, use library hook), payload bytes before/after, validation (all scripts, tsc, eslint, next build, git diff --check). Report once at the end.
