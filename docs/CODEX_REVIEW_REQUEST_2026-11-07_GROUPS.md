# Codex: review sounds in groups, group copy/cut/paste and split everything (2026-11-07)

The founder asked for the three gaps from your multi-select review: group copy/paste, sounds in Ctrl+A and in the group, and a "split everything" key. Commit, local and not pushed: `git show HEAD` (`src/components/editor-tools.tsx`).

## Changes

**Selection model:**
- `multiKeys` holds `c:<seg>:<part>`, `t:<id>` and `s:<sound id>`. It is active only when there are at least 2 keys, the sound chooser isn't open, and either `sel` is set or no single sound is selected.
- `clearSel()` replaced every `setSel(null)`.
- `toggle(k)` takes Ctrl/Cmd/Shift-clicks from the timeline, the preview captions and the sound bars (`TimelineEdit.onSelectSound`).
- `selectAll` adds the sound pieces.
- Sound bars highlight from `selKeys`; trim handles show only on the single selection.

**Delete group:** `onDeleteMany` for clips and texts (unchanged) plus `onPieces(sounds without the selected ones)`, with one `remember()`.

**Copy group** (`CopiedGroup`): clips in timeline order through `clipCopy`, texts and sounds stored with `rel` = their offset from the group's start, and sound lengths kept from `pieceEnd`.

**Paste group:**
- If the group has clips: `insertIndex(time)`, `onInsertClip` for each at `at + i`, and the anchor is the timeline offset of the demo clip at that index (else `videoLen`).
- Otherwise the anchor is the playhead.
- Texts: `onAddText(null, [anchor + rel, … + len], text, t)`.
- Sounds: added on a new row at `anchor + rel`.
- Group cut is copy then remove.

**Ctrl+Shift+B** (`splitAll`, checked before Ctrl+B in `WholePlayer`), with one `remember()`, then `clearSel`:
- the clip under the playhead (the same 0.2 s rule as Cut);
- every text spanning the playhead by more than 0.3 s each side;
- every sound spanning it by more than 0.25 s.

## Claude's Chrome test

`/mnt/c/Users/farha/AppData/Local/Temp/mavya-enc/hk2.mjs`: local copy, fresh seed with 3 clips, 4 texts and 1 sound.
- **Ctrl+A:** 9 items including "Sound: red".
- **Ctrl+A then Delete:** 0 clips, 0 texts, 0 sounds. One Ctrl+Z restores 3, 4 and 1.
- **Ctrl-click a sound:** it joins a text in the group.
- **Copy Texts A and B, paste at 1 s:** they land at 1 s and 4 s (spacing kept), clipped to their clips' ends by `containTexts`.
- **Group with clip green and Text A, pasted at End:** "green copy" is appended as a 4th clip, and its Text A sits at 12–15.
- **Group cut of B and C, paste at 0:** they land at 0–3 and 3–6.
- **Ctrl+Shift+B at 4.5 s:** green becomes pieces 0–1.5 and 1.5–3, Text A becomes 3–4.5 and 4.5–6, and the sound becomes 0–4.5 and 4.5–12 (its in-file start becomes 4.5).
- tsc, eslint and `next build` pass.

## Review

**Review only. Do not change code, commit or push.** Write `docs/CODEX_REVIEW_2026-11-07_GROUPS.md` with a verdict ("ship" or blockers). Check brutally:
- **The selection invariants** (your earlier stale-group finding): sound-only groups, group plus chooser, group plus toolbar Sound, Esc, Undo and Redo.
- **Paste:** the anchor with the magnet off (gaps), with the hook, and pasting into the middle of the timeline (do later texts and sounds shift with inserted clips?). Sound rows, and pasted texts against caption containment.
- **Several `onInsertClip` calls in one event** (the `runRef` handling in `insertClips`).
- **`splitAll` ordering:** the clip split's `save` against `liveTexts` and `onPieces` in one event, and the minimum lengths.
- Any regression in single select, copy, paste, cut or delete.
