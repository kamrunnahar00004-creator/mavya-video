# Caption containment review — 2026-11-07

**Verdict: blockers.** Reviewed local HEAD `74490edcc1e5c007d6568c75a08c575ea2419c62`. The reported hook overrun is repaired, but the founder's rule is not yet enforced across generation and export frame boundaries. No application code changed; no commit or push performed.

## Blocking findings

### P1 — Rounding the contained end can still export a caption on the next clip

`src/lib/edit.ts:166` rounds the clip end to milliseconds before clamping. Both renderers then round that value to a frame, whereas `render/render.mjs:158` plans cuts using the unrounded cumulative duration.

Concrete reproduction using the actual `timeline`, `containTexts`, and `exportLayers`: generated hook duration/trim end **1.0166 s**, speed 1, followed by a demo; caption starts at 0 and ends at 2. Containment returns **1.017**. At 30 fps the next clip begins at `round(1.0166 * 30) = 30`, but the caption's last frame is `round(1.017 * 30) - 1 = 30`. It appears on the next clip's first frame.

This affects browser export (`src/lib/browser-export.ts:317`) and server export (`render/render.mjs:312`). The server expected-layer check uses `exportLayers` and therefore accepts the same erroneous end; the route correctly derives overlay times from expected layers rather than trusting submitted times, but cannot repair this discrepancy.

Required: constrain overlay frame ranges to the owner's actual cumulative cut frame, or otherwise retain sufficient precision through containment and export. Verify fractional-speed and multi-piece cumulative edges, including edges just below half-frame thresholds. The existing frame formulas are consistent when supplied the exact same edge; millisecond rounding breaks that premise.

### P1 — Generation can move a hook caption onto the demo and bypass containment

`src/lib/generation-edit.ts:13` still uses `retimeTexts`, which enforces a 0.3 s minimum after mapping. The server generation completion writes this patch (`src/lib/server/generation-jobs.ts:174`), and `reconcileGeneration` installs its texts directly (`src/components/run-view.tsx:285`), without containment.

Concrete reproduction with actual `generationPatch`: a 2 s generated hook with an `id: "hook"` caption at **1.9–2.0**, followed by a demo; replace the hook with a different generated source lasting **1 s**. The resulting hook caption is **1.0–1.3**, entirely on the demo. `retimeTexts` maps both edges to 1.0 and then invents 0.3 s. The clean reconcile branch copies it; dirty reconciliation also calls `generationPatch` and can produce the same result.

Adding `containTexts` after this mapping alone is insufficient: its start now belongs to the demo, so it remains there, including in export. Ownership must survive retiming, or text whose source interval disappeared must be removed instead of being resurrected at the next clip. Cover clean and dirty generation completion as well as replacement/history selection through `applyGenerated`, which also uses `retimeTexts`.

## Other paths and edge cases

- **Supplied run:** independently ran the actual TypeScript helpers against the supplied JSON. `containTexts` changes 9 captions: the 3 hook leaks end at **2.345**, and 6 rounding overruns are shortened. A second application returns the same array. This confirms the reported repair, not a universal frame guarantee.
- **Preview:** `RunPreview` renders supplied texts with `showsAt` (`src/components/run-preview.tsx:159`); it does not independently contain them. Load normalization and ordinary saves help, but generation bypasses them. `liveTexts` also exposes unconstrained times until the 250 ms commit callback, so a running preview can briefly show a dragged/edited caption over another clip before normalization.
- **Moving a caption across a cut:** after commit, start-based ownership deliberately reassigns it to the destination clip and shortens its end. Moving it back cannot recover the discarded duration. This is coherent with the proposed start-based policy, but does not preserve original clip identity.
- **Gaps / magnet off:** texts starting in gaps are intentionally unchanged, even if they extend into a later clip. For example, hook 0–1, gap 1–2, caption 1.5–2.5: preview and both exports show it over the following clip. This is an explicit limitation of the requested implementation, not enforcement of a universal “never over another clip” rule. Confirm that gap captions are intended to be unowned; otherwise define their ownership/end policy.
- **Boundary tolerance:** a start within 0.5 ms before a clip's end is excluded from that clip and may be assigned to the next clip even before its actual start. A start in that tolerance band immediately before a gap is unmatched and can escape clamping altogether. Millisecond-rounded clip edges usually motivate this tolerance, but arbitrary submillisecond inputs remain accepted by server validation.
- **Minimum length / zero length:** containment can make captions shorter than the editor's usual 0.3 s minimum; it does not pad them back out. Reproduced a valid 1 ms result (1.016–1.017 on the 1.0166 s hook). Such a caption can quantize to zero output frames. Server validation accepts positive lengths, so short positive results do not themselves break PATCH. For ordinary millisecond starts inside the ownership window, clamping does not create a zero-length result. No zero-length result caused by this helper was demonstrated for valid timeline segments. Existing nonpositive inputs are not repaired; export filters them, while PATCH rejects them. The generation minimum-length resurrection above is the concrete demonstrated failure.
- **Hook id / legacy data:** `containTexts` treats `hook` like any other id, which fixes additional hook captions rather than only the named one. `runTexts` supplies legacy hook text; export retains stable `legacy-export-N` ids. Legacy generated hooks can initially derive an unspeeded caption duration, but containment shortens it if its start is still inside the hook. No new missing-`texts` crash found.
- **Undo / restore:** piece Undo uses `setParts` → `remapTexts` → `save`; whole-editor restore supplies hook, demo and texts together to `save` (`src/components/run-view.tsx:1236`). Those paths receive normalization against the restored timeline. Restore cannot faithfully restore an intentionally cross-clip caption: containment shortens it. `remapTexts` already drops collapsed intervals, unlike `retimeTexts`.

## Stale runRef and persistence

`save` reads `runRef.current` outside the functional state update; that ref is normally synchronized by an effect (`src/components/run-view.tsx:102`). A patch containing hook, demo and texts is self-contained for the relevant timeline sections, so restore and most timeline edits are insulated. A text-only patch or a patch changing only one timeline section can instead be normalized against an older untouched section if another update is queued before the effect runs. Since clamping discards information, applying the patch to newer React state afterward cannot recover a wrongly shortened end. I did not establish a routine user-event reproduction of this race; it is a structural risk, not an additional confirmed blocker. Computing the merge and normalization from the actual current state would remove that dependency. Note also that insertion paths manually overwrite the ref with their pre-normalization texts after calling `save` (lines 674 and 746), allowing an immediate ref-based action to see a different snapshot until the effect catches up.

**Should PATCH enforce containment? Yes, as a persistence invariant on the merged run**, including timeline-only patches, with an explicit policy for gap/unowned and collapsed captions. Currently it validates shape and positive durations but stores cross-clip ranges. That would cover direct PATCH clients and missed browser save paths. It would not cover generation's direct store write by itself; use a shared normalization boundary for all relevant writers. Nor would it solve lost ownership after retiming or the export frame-rounding defect by itself. Export should retain its own final guard for older data.

## Validation scope

Used a temporary Node harness with the installed TypeScript transpiler to execute repository `edit.ts`, `generation-edit.ts`, and `export-layers.ts`; the client dependency was reduced to its actual `runTexts` function and display constants. Reproduced the supplied-run changes, identity/idempotence, the 30 fps boundary mismatch, generation's 1.0–1.3 s resurrection, and a subminimum positive caption. Inspected preview, browser/server rendering, export validation, PATCH, generation storage/reconcile, and restore paths. No interactive browser session or actual media render was performed. Did not rerun build/lint/typecheck: the reported passing checks do not exercise these semantic failures.

## Round 2

**Verdict: blockers.** Reviewed HEAD `dc62726a23b209d133629cc3ac2ee922a5c82066`. The original numerical counterexamples pass, but the new exact start comparison destroys real captions in the supplied run, and generation still transfers captions in the old hook's final 50 ms onto the demo.

### P1 — Exact start ownership truncates real captions to zero exported frames

`containTexts` now compares millisecond-saved starts against exact clip offsets, while `snapTexts` still snaps to **rounded** offsets. A saved start just before an exact boundary is therefore assigned to the preceding clip and clamped to that boundary. Exact ends are necessary for export, but exact ownership comparisons without accommodating saved start precision are destructive.

Reproduced with the supplied run and actual helpers:

| Path | Caption | Before | After | Export frame range at 30 fps |
| --- | --- | --- | --- | --- |
| Direct `exportLayers` / containment | `my insta reels had no views😭` (`dk2vs5pf`) | 2.345–4.391 | 2.345–2.3454545454545452 | 70–69: no frames |
| Load: `containTexts(snapTexts(...))` | `browse viral hooks` (`zpcf0le2`) | 4.391–7.295 | 4.390–4.390454545454546 | 132–131: no frames |

The latter also affects the companion captions `on ` and `mavya.app`, which share its start. `snapTexts` moves their start to 4.390, the rounded start of their intended clip; containment then treats them as belonging to the preceding clip. The load handler persists these shortened ranges, and the PATCH normalization now also persists this classification. This is more serious than a transient preview issue: valid captions lose essentially their whole duration.

Required: resolve ownership using the saved precision or explicit ownership, while preserving exact ends for frame quantization. Test the actual **load pipeline**, direct export, and PATCH normalization against all supplied captions. A “zero leaks” assertion must also verify that intended captions retain their expected visible frames; removing their visibility is not a successful fix.

### P1 — The last 50 ms of a regenerated hook still become demo captions

`retimeTexts` defines ownership as `t.start >= offset - 0.05 && t.start < offset + oldLen - 0.05`. This excludes starts in the old clip's final 50 ms, although those starts are inside that clip.

Reran the original 2 s → 1 s generated-hook case with a different generated source and a following demo:

| Original hook caption | `generationPatch` result | Clean reconcile | Dirty texts + adjust reconcile | `exportLayers` |
| --- | --- | --- | --- | --- |
| 1.900–2.000 | 0.700–1.000 | 0.700–1.000 | 0.700–1.000 | 0.700–1.000 |
| 1.950–2.000 | **1.000–1.300** | **1.000–1.300** | **1.000–1.300** | **1.000–1.300** |
| 1.980–2.000 | **1.000–1.300** | **1.000–1.300** | **1.000–1.300** | **1.000–1.300** |

These are positive-duration inputs accepted by server validation; the editor's usual 0.3 s minimum is not a storage invariant, and containment itself permits shorter durations. The remapping still collapses the excluded caption onto 1.0 and pads it to 1.3. All subsequent containment assigns it to the demo. Required: include the entire actual old clip in the ownership decision, with a consistent policy for rounded boundary starts, rather than removing the final 50 ms from ownership.

### Fixes verified and remaining scope

- The 1.0166 s hook now retains end **1.0166**; its cut is frame **30**, and the caption's last frame is **29**. The original one-frame counterexample is fixed.
- Gap case (hook 0–1, next clip starts at 2, caption 1.5–2.5) now returns **1.5–2.0**. The former gap overrun is fixed.
- The original 1.9–2.0 generation example now returns **0.7–1.0**, including clean and dirty reconciliation. The neighboring cases above remain blockers.
- Containment on the supplied run remains idempotent. Idempotence does not detect the lost captions above.
- A caption at 1.016–1.4 on the 1.0166 s hook becomes a positive **0.0006 s** interval. Short positive durations remain allowed, and zero-frame export intervals remain possible. No server validation rejection is implied by that positive duration alone.
- PATCH now normalizes merged texts for text, hook and demo changes, including timeline-only patches, and reuses the fetched run for hook/demo changes. This addresses the missing enforcement boundary in Round 1 by inspection, but uses the ownership logic responsible for the first blocker. No live authenticated PATCH request was performed.
- Preview still consumes the supplied text ranges; generation normalization now covers both reconcile branches, but cannot recover captions already classified into the wrong clip. Undo/restore and normal saves likewise inherit the ownership problem. The previously noted `runRef` synchronization risk and brief unconstrained live-text preview window are unchanged; neither is needed to reproduce these blockers.

Validation: reran the temporary TypeScript-transpilation harness against current repository helpers and the same supplied run JSON, including load-time snapping, direct export, generation, both reconciliation branches, gap containment, short-duration containment, and frame formulas. Client dependency isolation is as described in Round 1. No application code changes, interactive media render, or live API mutation; did not rerun the reported static/build checks. Only this review document was edited for Round 2. No commit or push performed.
