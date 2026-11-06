# Groups review — 2026-11-07

Verdict: **blockers — do not ship HEAD `a22c6176cf31d1516d732c2db99827da1caed5f2` yet.**

Reviewed the commit, surrounding selection/player code, `run-view` mutation/save paths, timeline/caption helpers and sound playback helpers. No application code was changed. No commit or push was made.

## Findings

### 1. P1: Copying nonadjacent clips loses their spacing but preserves the old caption/sound offsets

Locations: `src/components/editor-tools.tsx:1655–1668`, `:1685–1694`.

Clip positions are calculated as `lo` while copying, then discarded: `CopiedGroup.clips` stores no relative position. Paste packs all selected clips together, while captions and sounds retain offsets from the original group start. This breaks the relationship between those layers and their clips.

Reproduction: use the 12-second timeline with a 3-second hook and three 3-second demo clips. Select green (3–6), orange (9–12), and an orange caption at 9–12; copy and paste at End. The pasted clips occupy 12–15 and 15–18, but the orange caption lands at **18–21**, outside the video. `containTexts` deliberately leaves captions past the video alone, so it does not repair this. This was reproduced through the actual extracted copy and paste functions and timeline helpers. Group cut makes the consequence worse: the original caption is removed before its replacement becomes invisible.

A sound or caption starting before the earliest selected clip creates the same mismatch even with only one copied clip: the group base includes that earlier item, but the clip still goes directly at the anchor. Preserve clip-relative placement, or explicitly remap all copied layers to the packed clip layout. All layers need the same mapping.

### 2. P1: Pasting overlapping sounds onto one new row truncates the copied audio

Locations: `src/components/editor-tools.tsx:1698–1699`; `src/lib/sound.ts:55–58` (`pieceEnd`).

Every copied sound receives the same new `row`, regardless of its original row. `pieceEnd` ends a sound at the next later sound on its row, so preserving its stored `end` does not preserve its audible length.

Reproduction: select sounds on separate rows spanning 0–6 and 2–6, then copy/paste at 0. Both copies receive the same row. The first copy's effective end becomes **2**, losing four seconds of audible content. The direct harness confirmed this with the actual paste function and `pieceEnd`. Sounds starting at the same time overlap visually on that one row instead.

Map distinct source rows to distinct new rows, preserving overlap and each copied piece's effective length.

### 3. P2: With magnet off, the group anchor includes a gap that the inserted clip does not inherit

Locations: `src/components/editor-tools.tsx:1687–1694`; `src/components/run-view.tsx:755–771`.

The anchor uses the next existing clip's old `offset`, including that clip's preceding gap. `insertClips` inserts the copied clip before that gap; the gap remains attached to the existing clip.

Reproduction: hook 0–3, then a two-second gap, then green 5–8. Paste a 3-second clip and its full-length caption before green, with the playhead at 3. The inserted clip occupies **3–6**, but its caption starts at **5**. Containment then shortens the caption to **5–6**. A copied sound with relative offset zero also starts two seconds late. The executable check confirmed the clip/caption positions and truncation.

Derive the anchor from the inserted clip's resulting timeline position, or make insertion and gap placement follow the same anchor policy.

### 4. P2: Inserting group clips moves later captions but leaves later sounds behind

Locations: `src/components/editor-tools.tsx:1690`, `:1699`; `src/components/run-view.tsx:763–771`.

`insertClips` shifts existing texts at/after the insertion point, but never shifts sounds. The group-sound branch also rebuilds its result from the original `sounds.pieces`. Existing audio therefore loses synchronization with downstream clips and captions.

Reproduction: a caption and sound both span 6–9 under blue. Paste two 3-second clips before blue. Blue and its caption move to **12–15**; the sound stays at **6–9** underneath the inserted content. Confirmed by the direct insertion/paste check. This also happens when the copied group contains no sounds.

This is an existing insertion-path limitation exposed by the new group feature, not a newly introduced sound-retiming implementation. It remains a blocker for synchronized group insertion. Define the insertion/ripple rule for audio and apply it consistently, including when merging pasted sounds with the retimed existing sounds.

### 5. P2: Sound-only groups cannot be deleted with the visible Delete toolbar button

Locations: `src/components/editor-tools.tsx:1602`, `:1872` (`canDelete` and the toolbar button).

Sound-only groups correctly clear both `sel` and `sounds.selId`. However, `canDelete` only checks a selected text, an individually deletable clip, or a single selected sound. It never checks `multi`.

Reproduction: select one sound, then Ctrl-click a second sound. Both highlight, and keyboard Delete reaches the correct group-removal branch, but the toolbar Delete button is disabled. The actual toggle and `canDelete` expressions reproduced this. A group whose representative is the protected unsplit hook can encounter the same mismatch despite containing other deletable items.

Enable Delete when the group contains deletable members, using the same selection semantics as `remove()`.

## Selection invariants

- Sound-only groups work in the operative selection model: modifier-clicking a second sound clears the individual sound selection and retains both sound keys. Toggling back to one sound restores its individual selection. Both transitions passed direct execution of the current toggle body.
- Mixed groups retain a clip/text representative for the settings panel. A plain clip/text pick clears sound selection and group keys; a plain sound pick and Escape go through WholePlayer's `onSelect`, clearing the keys and calling `sounds.select`.
- The toolbar Sound button calls `clearSel()` before `addAt`. Choosing a new sound cannot leave the old group operative. With existing sounds and the chooser open, the `multi` guard also suppresses old keys. `sounds.select` closes the chooser, so toggling a fresh group does not revive the old one. With no existing sounds, the chooser is the default panel state; the explicit exception allows a clip/text group to remain active in that situation.
- Undo/Redo clear group keys and `sel`; snapshots include hook, demo, texts and sounds. Group removal calls `remember()` once, deletes clip/text members through the existing batch handler, and removes sound IDs separately without another history call. Restoring the snapshot uses one `onRestore` callback. These are source-audited conclusions; browser Undo/Redo was not independently executed.
- `clearSel()` does **not** clear the internal individual sound selection despite its comment. Undo/Redo or split-all can leave a surviving sound selected; a missing ID is masked by `useSounds`' found-index check. This does not resurrect a group, but “clear every selection” is not literally implemented. Escape does clear it through `sounds.select(null)`.

## Repeated insertion and caption containment

- Multiple `onInsertClip` calls in one paste preserve all inserted clips. Each `insertClips` reads `runRef.current`, saves, and synchronously replaces that ref before the next call. The direct two-clip check retained both clips in order and shifted a downstream caption twice, from 6 to 12.
- The insert saves enqueue functional state merges; subsequent `liveTexts` additions operate on that resulting state. Added captions are not overwritten by a later clip insert because all clip inserts run first. Text persistence is debounced, and `patchRun` merges pending patches and serializes requests. No demonstrated same-event lost-insert bug was found.
- Pasting while inside the hook inserts demo clips after the hook. A no-gap check placed both the copied clip and its caption at 3 seconds. Pasting after the final demo uses `videoLen`; this is correct for contiguous groups with a common base at their first clip.
- Text-only groups keep offsets from the earliest selected text and anchor at the playhead. `onAddText` passes the copied template, preserving appearance and position. Captions are then contained by their destination clip at commit time; crossing a destination clip edge shortens them by design. A caption starting in a gap ends at the next clip's start; one starting beyond the final clip is left alone. This explains why containment amplifies finding 3 and cannot rescue finding 1.

## Split-all ordering, lengths and single-item regressions

- Ctrl/Cmd+Shift+B dispatches before ordinary Ctrl/Cmd+B. The typing, active-player and unrelated-dialog guards remain in front of dispatch. Accepted split-all actions stop playback; rejected actions create no history entry.
- The clip `onParts` save runs first, followed by functional `liveTexts` patch/add operations, followed by the sound-only save. The final save merges only sounds and does not overwrite texts or demo. A direct ordered-update harness using the actual `partsChange`, `setParts` and `splitAll` bodies preserved the clip split, both caption halves and both sound halves, with one `remember()` and one `clearSel()` call.
- Clip checks use timeline duration after speed conversion, requiring more than 0.2 seconds on each side. Texts require more than 0.3, sounds more than 0.25. Clip cases below the threshold were executed and did not split. The code evaluates each layer independently, so an unsplittable clip does not prevent a sufficiently long sound/text from splitting.
- Edges round to milliseconds after those checks, so the strict thresholds are approximate near floating-point/rounding boundaries. More materially, sound source offsets still use `round1`: a split at 4.533 seconds sets the second sound's source start to **4.5**, replaying about 33 ms. This was confirmed directly. It inherits ordinary sound split's existing precision limitation; it is not a state-ordering failure, but split-all is not sample-continuous at arbitrary playhead times.
- Ordinary single text/clip copy, paste, cut and delete retain their prior branches. `clipCopy` is the extracted previous single-clip implementation. It still copies `seg.adjust`, not a piece's own visual adjustment overrides; that is pre-existing behavior rather than a new regression.
- Single-sound copy/cut remains unsupported: `copy` has no single-sound branch and `canCopy` is false. Ctrl+V can consequently paste an older clipboard item after a no-op sound copy. Sound **groups** are supported by the new branches; parity for individual sounds is still missing.
- The hook preservation rule remains: selecting every hook piece does not delete the hook. Group cut can therefore copy a protected hook without removing it. This is inherited behavior and should not be described as a move of every selected item.

## Validation and limits

- `npx tsc --noEmit`: passed.
- `npx eslint src/components/editor-tools.tsx src/components/run-view.tsx`: passed.
- `npm run build`: passed. Existing warning: TikTok Sans fallback font override metrics unavailable.
- Temporary executable harness: `/tmp/groups-review.cjs`. It transpiles/extracts the current component functions, loads the real timeline/containment/sound helpers, and models ordered functional state updates and save containment on a cloned synthetic run. All final assertions passed, including assertions confirming the reported defects. No run data or application files were patched.
- This harness is not a mounted React/browser test and does not prove browser event scheduling, mouse/keyboard focus behavior, persistence after reload or actual media playback. Selection/Undo/Redo/chooser conclusions not identified as executable checks above are source inspection. Claude's Chrome results remain supplied evidence, not independently rerun results.

Only the requested review document was created by this review. Fix the five findings, then rerun sound-only toolbar deletion, overlapping-row copy/paste, nonadjacent group cut/paste, gapped insertion, and middle insertion with synchronized captions/audio, including one-step Undo/Redo and reload.
