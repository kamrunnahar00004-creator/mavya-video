# Codex review request: Mavya, full app + business plan (2026-10-19)

Third review, and the bluntest one yet. The founder wants a brutal pass before the
backend sprint (Export, accounts, Stripe). Read first, in order:

1. `docs/CODEX_REVIEW_REQUEST_2026-10-15.md` (product, stack, how to run).
2. `docs/CODEX_REPORT_2026-10-15.md` and `docs/CODEX_REPORT_2026-10-16.md` (your own earlier findings).
3. `docs/CODEX_REVIEW_REQUEST_2026-10-16.md` (editor model: pieces, gaps, magnet, history).

Then do three jobs, in this order.

---

## Job 1: brutal code review (fix what is safe)

Review **everything**, not only what changed: bugs, logic errors, bad data states,
race conditions, stale state, security of every API route, performance, dead code,
stale comments, anything confusing. Assume nothing works until you have checked it.

- **Fix** what is clearly a bug and safe to fix: small focused commits, one topic each,
  message says what and why.
- **Do not fix**, only list: anything needing a product decision, a redesign, a copy
  change, or a change to the interaction model.
- Re-check every open item in section 3 of `docs/CODEX_REPORT_2026-10-16.md`: still
  open, fixed by later work, or worse?

### Changed since your last review (40 commits, `cf5ae18..HEAD`)

Mostly marketing pages; the studio itself barely changed.

| Area | What | Main code |
| --- | --- | --- |
| Landing `/` | Hero with three looping library videos, hook + demo explainer, How it works (4 step "Mac window" screens with fake UI and real library videos), FAQ, CTA | `src/components/landing.tsx`, `hook-demo-explainer.tsx`, `how-it-works.tsx`, `loop-video.tsx` |
| Pricing `/pricing` | Plan cards (Starter $29, Pro $59, Studio $99; yearly $290/$590/$990), dark Business card (pay for results), "One tool instead of six." cost card with tool logos, compare table, FAQ | `src/components/pricing-page.tsx`, `src/lib/plans.ts` |
| Billing `/billing` (in app) | Plan cards + usage, checkout not connected | `billing-view.tsx`, `plan-cards.tsx` |
| Shared chrome | Header, footer, Mavya rocket mark, favicon | `marketing-chrome.tsx`, `src/app/icon.svg`, `app-shell.tsx` |
| Route group | Studio, library and billing live in `src/app/(app)` with the sidebar; `/` and `/pricing` have none | `src/app/(app)/layout.tsx` |

Things Claude already suspects (verify, do not assume):

- `billing-view.tsx` comments still say "everyone is on Free"; there is no free plan any more.
- Landing and pricing autoplay many videos at once; check memory, network, and what a
  phone on 4G downloads before first paint.
- `how-it-works.tsx` timers and per-step state when the user switches steps fast or the
  tab is hidden.
- `CostStack` in `pricing-page.tsx` counts up with an IntersectionObserver; check it
  never shows a wrong total (reduced motion, fast scroll, re-entry).
- `run-view.tsx` is still around 4,500 lines.

## Job 2: claims vs reality (list only, change nothing)

The landing and pricing pages promise things. For **every** promise, say whether the
product does it today, partly, or not at all, with file evidence. Examples to check:

- "AI video hooks" (generation is a stand-in sample clip: `run-view.tsx`, `TODO(Runway)`).
- "Unlimited AI characters", "or your own face" (face swap is not connected).
- "Unlimited edits", "Unlimited exports" (Export is not built: `run-view.tsx` toast).
- "Unlimited shot-by-shot scripts" (are shot lists generated, or a fixed default?).
- "Trending songs" (Deezer 30 s previews saved locally).
- Pro "Weekly review and feedback", "Priority generation"; Studio "We review every
  video", "1:1 guidance". What has to exist (process or code) to deliver these?
- Business "pay for results", "views quota", "miss it, you don't pay": nothing defines
  the quota, the minimum or how views are measured.
- "in minutes", "Your first video, today", any number or timing claim on either page.

## Job 3: business and feature plan review (write, do not build)

Be honest, not encouraging. The founder asked "what can we add, what is a must, what is
remaining".

**The business, as it stands**

- Product: short-form "hook + demo" videos for SaaS and app founders. Pick a viral hook
  from a curated library (Instagram, curated by the founder via Meta Business Discovery,
  ~230 live), recreate it with an AI character or your own face, add your app demo
  (upload or clip by clip with a shot list), text on screen, a song, export.
- Competitors: Yorby (closest), Hooked.so, Arcads, Creatify, ReelFarm, Virlo, plus the
  "six tools" stack on the pricing page (Virlo, ChatGPT, Higgsfield, Arcads, CapCut,
  Epidemic Sound). Founder's wedge: everything works, dead simple, sharp copy, one
  clear customer. Founder is an expert at short-form marketing.
- Pricing: no free plan. Starter $29 (20 AI hooks/month), Pro $59 (60 + weekly review),
  Studio $99 (150 + every video reviewed + 1:1), Business pay for results with a
  minimum. Yearly = 2 months free. Prices are fixed by the founder; review the
  structure and limits, not the price points.
- Planned generation: Runway (motion transfer / Aleph style) or Veo 3.1 for the hook
  clip. Not connected yet. No real cost per hook measured yet.
- Not built: Export (ffmpeg render), accounts, Stripe, hosting (everything is local:
  `.data/db.json`, `.data/media`), usage limits, analytics.

**What to answer**

1. **Unit economics.** Estimate cost per AI hook (Runway and Veo, from their public
   pricing; show the math and the date of the price you used) and gross margin per plan
   at full usage. Is 150 hooks for $99 survivable? What limit or fair-use rule is
   needed? Include render, storage and bandwidth.
2. **Must have before the first paying customer.** A short, ordered list. For each:
   why it blocks money, rough size (S/M/L), and what can stay manual (for example the
   founder reviewing videos by hand).
3. **Should add soon after.** Things that clearly raise conversion or retention.
4. **Do not build.** Things that look tempting and are a waste right now. Be specific.
5. **Risks that could kill it.** Legal and platform: recreating other creators' viral
   hooks, storing their full videos and covers, Instagram embeds, Meta Business
   Discovery used for a commercial library (dev mode app), Deezer previews as
   "trending songs" in exported videos, AI characters and FTC/AI-label rules, likeness.
   State each risk plainly with the safest fix that keeps the product. Do not lecture;
   the founder decides.
6. **Hosting plan.** The cheapest sane path from localhost to paid users: where the app,
   database, files and render worker live, and what moves first. The founder has used
   Vercel, Supabase, Stripe and Google auth before; no AWS account.
7. **Anything the founder has not thought of.**

---

## Rules

- Checks that must stay clean: `npx tsc --noEmit`, `npx eslint src`,
  `node scripts/review-checks.cjs` (add cases for anything you fix in `src/lib`).
- Local git only, branch `main`. Never commit `.data` or `.env*`. Never delete the
  founder's runs in `.data/db.json`; make your own test runs through the API and delete
  them after.
- Do not change: the look (violet `#7b4cfa`, ink-bordered primary buttons with hard
  shadow, cool greys, rectangular buttons), copy, prices, plan contents, the interaction
  model.
- No em-dashes or en-dashes anywhere, code comments included. No filler text.
- On-screen video text is static: no text animations.
- AI runs only on an explicit click.
- No scraping, no third-party downloaders.

## Report: `docs/CODEX_REPORT_2026-10-19.md`

1. **Summary**: 5 lines max.
2. **Fixed**: one line per fix: commit hash, the bug, how to reproduce it before the fix.
3. **Found, not fixed**: severity (high / medium / low), problem, concrete repro,
   suggested fix, why not done.
4. **Open items from 2026-10-16**: each one, with its status now.
5. **Claims vs reality**: table with claim, page, status (yes / partly / no), evidence.
6. **Business and feature plan**: the seven answers from Job 3.
7. **Checks**: output of the three checks at the end.

Claude verifies every fix and finding afterwards.
