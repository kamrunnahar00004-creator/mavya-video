# Codex: review "Captions stay inside their own clip" (2026-11-07)

The founder saw a hook caption over the next clip. Run `b6080024-d314-4e07-8f5a-57fe7139c127` (export `e9a82f34-985e-48a9-8b32-01b595eead2e`):
- the hook lasts 0 to 2.345 s (2.58 s of footage at 1.1x speed);
- three hook captions ("the best marketing tool", "for my saas", "🤯") ended at 2.645 s, so they showed over clip 2.

Root cause, as far as Claude can tell: the hook trim handler in `run-view.tsx` (around `save({ hook: next, texts: texts.map(... x.id === "hook" ? { ...x, end: Math.min(x.end, newLen) } ...)`) shortens only the text with id `hook`.

**Founder's rule:** a subtitle must stay inside the clip it is meant for.

The commit is local and not pushed (`git show HEAD`). It adds `containTexts(texts, segs)` in `src/lib/edit.ts`: a text belongs to the clip its start lies in, and its end is clamped to that clip's end; texts in gaps or past the video are left alone. It is applied in five places:
1. on load in `RunView`, after `snapTexts`, with the existing `patchRun`;
2. in `save()` when the patch carries `texts`, against `timeline({ ...runRef.current, ...patch }, null)`;
3. in `commitTexts`, after a text drag or edit;
4. in `liveAdjust`, on a speed change;
5. in `exportLayers`, used by both the browser export and the server's expected-layer check.

Claude ran it on this run's data: 9 texts fixed (the 3 real leaks plus 6 one-millisecond rounding overruns), 0 leaks afterwards, idempotent. tsc, eslint and `next build` pass.

**Review only. Do not change code, commit or push.** Write `docs/CODEX_REVIEW_2026-11-07_CAPTION_CONTAIN.md` with a verdict ("ship" or blockers). Check brutally:
- Does any path still show or export a caption over the wrong clip? Check the preview (`run-preview.tsx`), the server export (`render/render.mjs` overlays, the export route's layer check), the generation reconcile (`generation-edit.ts`, `reconcileGeneration`) and Undo/restore.
- Can it break the editor? Moving a text across a clip boundary, texts in a gap (magnet off), the hook text (id `hook`), legacy runs without `texts`, the minimum text length, zero-length results, and frame quantization at the end (`round(end * fps) - 1` against the cumulative cut frames).
- Stale `runRef` in `save()`: could containing against a stale run clamp wrongly?
- Should the server PATCH route also enforce this?
