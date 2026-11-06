# Codex: review editor multi-select and CapCut hotkeys (2026-11-07)

The founder asked: "in the editor with ctrl or del key why can't you select multiple clips, make the hotkeys exactly like capcut".

Commit, local and not pushed: `git show HEAD`.

**Editor** (`src/components/editor-tools.tsx` `VideoEditor`):
- `multi` holds the selection keys, `t:<id>` for texts and `c:<seg>:<part>` for clips.
- `pick(next, add)`: with Ctrl, Cmd or Shift held, the item joins or leaves the selection.
- `selectAll` (Ctrl+A) selects every clip piece that has a source, plus every text. Esc, Undo and Redo clear the selection, and so does selecting a sound.
- Delete with several selected calls the new `onDeleteMany` (one `remember()`).
- `TimelineEdit` gains `selKeys` and an `add` flag. `pressClip` and `dragText` return early on a modifier-click (no seek, no drag). Trim handles show only on a single selection.

**Delete** (`src/components/run-view.tsx`):
- `setParts`'s logic moved into a pure `partsChange(r, …)`.
- `deleteMany(textIds, pieces, hold)` folds the text removals, piece removals (`partsChange`) and whole demo clips (`removeDemoClip`) over one working copy, then calls `save` once. The hook always keeps a piece.

**Keys** (`WholePlayer`): Ctrl+X cut (copy, then delete, single selection only), Ctrl+A, ←/→ one frame at 30 fps (Shift: 1 s, was 0.1 s / 1 s), ↑/↓ previous/next cut (clip edges, 0, end), Home/End.

**Claude's test.** A local credential-free dev copy with a seeded run: a hook plus 3 demo clips with real media, and 4 texts. Windows Chrome driven over CDP, with real mouse and keyboard events. Results:
- Ctrl-click two texts and Shift-click two clips: both selected.
- Delete two clips: their texts go with them, as with the existing single delete. Saved, and one Ctrl+Z restores all.
- Ctrl+A then Delete: the demo clips and texts go and the hook stays. Undo restores.
- Ctrl-click toggles an item off. Esc clears.
- Ctrl+X / Ctrl+V on a text work.
- ← and → move exactly 1/30 s, Shift+→ 1 s; ↑/↓ land on the cuts; End goes to the end.
- tsc, eslint and `next build` pass.

**Review only. Do not change code, commit or push.** Write `docs/CODEX_REVIEW_2026-11-07_MULTI_SELECT.md` with a verdict ("ship" or blockers). Check brutally:
- `deleteMany` correctness:
  - several pieces of one clip;
  - pieces across clips, with the magnet on and off (gaps);
  - the hook's pieces;
  - text removal and containment;
  - the stale `run` closure.
- Undo of a multi-delete.
- Key conflicts: Ctrl+A or Ctrl+X while typing in text inputs, the browser's own Ctrl+A, the phone preview (`run-preview.tsx`) and step 5 also using `WholePlayer`.
- A modifier-click on the preview's text.
- Any regression in single-select behaviour, drag, trim, Cut (S / Ctrl+B), copy and paste.
- Which CapCut desktop shortcuts are still missing or differ, as far as you know.
