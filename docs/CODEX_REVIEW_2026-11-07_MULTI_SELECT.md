# Editor multi-select review — 2026-11-07

Verdict: **blockers — do not ship this commit yet.**

Reviewed HEAD `6f8fdf5feff175d945441a7362a05ef0cbd88614`, its diff, the surrounding editor/player/save code, and Claude's supplied CDP script. Application code was not changed. No commit or push was made.

## Findings

### 1. P1: Adding a sound preserves the previous multi-selection, so Delete removes the wrong objects

Locations: `src/components/editor-tools.tsx:1751`, `:1266`, `:1608`.

Reproduction from the code paths: select two demo clips or texts; click the toolbar's Sound button; choose a sound; then press Delete while the new sound is selected. The toolbar clears `sel` but never clears `multi`. `useSounds.pick` selects the newly created sound internally, bypassing WholePlayer's `onSelect` callback (which does clear `multi`). The side panel and sound selection can therefore show the new sound while `remove()` still prioritizes the old multi-selection. Delete removes the previously selected clips/texts and leaves the sound.

Clear both selection states when entering the sound workflow, and ensure internally selected sounds cannot coexist with a stale clip/text multi-selection. Verify Delete and its toolbar button target the new sound, and Undo restores that sound. This is a new regression caused by introducing a second selection state without updating this existing transition. This finding is established by control-flow inspection, not a completed browser reproduction.

### 2. P2: Up/Down skips the cuts created by S / Ctrl+B

Location: `src/components/editor-tools.tsx:558`.

The cut list contains only `g.offset` and `g.offset + g.len`. Split pieces remain inside one Seg, so their boundaries never enter the list. With a three-second generated hook split at 1 s and 2 s, ArrowDown from 0 lands at 3, skipping both cuts. The same happens within demo clips. This was reproduced using the actual timeline helpers and the handler's cut calculation.

Include piece boundaries, using `pieceSpans` so clip speed is respected. Check both directions, with gaps and non-default speeds. Claude's original unsplit fixture cannot detect this.

### 3. P2: Modifier-clicking preview text never adds it to the selection and can move it

Locations: `src/components/editor-tools.tsx:580`, `:660`; `src/components/run-preview.tsx:459–490`.

WholeMedia passes only `onTextMove` to TextOverlay. There is no selection callback or modifier handling. Ctrl/Cmd/Shift-click on a visible preview caption leaves the old selection unchanged; pointer movement starts an ordinary position edit even with the modifier held. Delete afterward acts on the old selection. This contradicts the timeline's modifier-click behavior, and the requested preview case remains unimplemented. The ordinary preview drag behavior predates this commit; the missing multi-select integration is the gap here.

Pass selection/modifier intent through the preview overlay, returning before installing drag listeners for a modifier-click. Verify selection toggling without seek, position changes, or an undo entry.

## Delete and Undo audit

Direct executable checks used the current `partsChange` and `deleteMany` bodies extracted from run-view, the actual edit/adjust/runTexts helpers, and a cloned seeded run with synthetic three-piece clips and explicit gaps. The test harness and seed snapshot are temporary files under `/tmp`; no live or local run was patched.

- Several pieces of one demo: grouped deletion retains the remaining piece and removes captions contained in each deleted piece. All pieces selected removes the demo through `removeDemoClip`.
- Across clips: partial deletions and a whole-demo-plus-partial-other-demo deletion passed with magnet on and off. With magnet off, surviving downstream clip offsets stayed fixed; gaps absorbed removed duration. Magnet on uses the existing ripple behavior, including removal of a deleted whole clip's preceding gap.
- Text IDs are filtered before retiming. Each subsequent operation reads the evolving working run, not the original text list. Surviving captions passed containment checks against the resulting timeline. `save` also applies `containTexts` before updating/persisting.
- Partial hook deletion passed. **Selecting every piece of a split hook leaves all of its pieces**, not just one: the empty-rest hook branch does nothing. This preserves the hook invariant, but is a policy discrepancy worth resolving explicitly. If the requirement is to delete as much as possible while retaining one piece, this needs a change. It is not counted as an independent blocker here because the request only explicitly promises that the hook stays.
- One save occurred per tested batch. The UI calls `remember()` once before the batch; Undo restores hook, demo, texts, and sounds through one `onRestore`/save. Redo snapshots the post-delete state and selection is cleared in both directions. No extra history entry is created by `partsChange`. This Undo conclusion is based on source inspection; I did not independently execute browser Undo.
- **Stale run closure:** the per-clip folding is correct: `partsChange(r, ...)`, `timeline(r, ...)`, and `runTexts(r)` use the updated working copy. The initial `r` still comes from rendered `run`, not `runRef.current`. WholePlayer refreshes callback refs after renders; ordinary separate user events should get current callbacks. I found no demonstrated stale-closure failure for a normal multi-delete. A same-render pair of programmatic mutations or concurrent update could still overwrite newer hook/demo/text fields; using a current-state transaction would harden this. `save`'s current-ref containment does not rebase an already stale patch.

## Keyboard conflicts and regressions

- Inputs, textareas, selects and contenteditable descendants return before shortcut dispatch. Native Ctrl+A/Ctrl+X remain available while typing; the editor's clip clipboard is unaffected. This also protects text fields in the settings panel.
- Ctrl+A in the active full player calls selectAll and prevents the browser's page selection. Outside its focus/active scope it retains native behavior. An unrelated open dialog blocks the player listener. These are source-audited results, not fresh CDP assertions.
- The phone preview has no competing global edit-key listener: its navigation handler is local to its slider and still steps by 0.1 s. The new global frame/cut keys apply to WholePlayer, not that slider. Modal guarding prevents the background step-5 player from processing keys while the full editor is open.
- Step 5 uses WholePlayer without copy/cut/select-all callbacks, so Ctrl+A/X fall through to native browser behavior there. Its arrows/Home/End inherit the new navigation, while S/Ctrl+B still splits sound. No new video deletion callback is installed there.
- Ordinary timeline clip/text clicks still take the previous seek/drag paths and collapse multi-selection to one item. Modifier-click returns before starting drag. Clip trim handles are hidden for multi-selection; text timing handles remain visible and ordinary use collapses selection before trimming. Full mouse drag/trim behavior was not independently rerun.
- S/Ctrl+B retains existing single-target split behavior. Ctrl+Shift+B is also caught by the broad Ctrl+B condition and performs that same split; it is not a split-all command.
- Single-item copy/paste retains the existing implementation. Ctrl+X copies then deletes, with multi-item cut explicitly disabled. Ctrl+C with multiple selected silently copies only `sel` (the last selected item), and Ctrl+A excludes sound pieces. Thus the visible selection is not a general group clipboard/selection implementation. Cutting the protected single hook copies it without deleting it.
- Navigation is hard-coded to 30 fps; near the end it clamps at `total - 0.01`, so a final arrow step need not be exactly 1/30 s. Home/End are 0 and 10 ms before the end. These are precision/semantic limitations, not evidence of source-frame navigation.

## CapCut parity

Do not describe this as “exactly like CapCut.” CapCut documents desktop Ctrl/Cmd+B, Space, frame arrows, and customizable shortcuts in its [desktop overview](https://www.capcut.com/resource/pc-professional-video-editor). Its [subtitle help](https://www.capcut.com/help/split-the-subtiltes) also documents Ctrl/Cmd+B and Ctrl/Cmd+scroll timeline zoom. This patch has no equivalent keyboard zoom implementation.

Other familiar desktop commands still absent from this handler include split-all, select/split tool modes, delete-left/delete-right, select-left/select-right, magnet/snapping shortcut toggles, and fit/zoom shortcuts. Exact default bindings vary by CapCut version/customization; I did not inspect an installed CapCut shortcut panel and do not certify a complete default-key table. Locally observable differences are definite: S is an extra split binding, Ctrl+Shift+B aliases single split, multi-item cut is a no-op, copy handles one selected item, sounds are excluded from Ctrl+A, preview modifier-selection is absent, and cut navigation skips piece boundaries.

## Validation and limits

- `npx tsc --noEmit`: passed.
- `npx eslint src/components/editor-tools.tsx src/components/run-view.tsx`: passed.
- `npm run build`: passed; warning about missing TikTok Sans fallback font metrics.
- Direct deletion harness: passed grouped/cross-clip/whole-plus-partial deletions, both magnet modes with gaps, partial hook deletion, text filtering/containment and single-save assertions. Confirmed the all-hook-pieces no-op and missing internal cut navigation.
- Local seeded server on port 3210 was reachable. Attempting the supplied script with Windows Node failed immediately with `WSL ... UtilBindVsockAnyPort ... socket failed 1`. Consequently I did not reproduce Claude's real mouse/keyboard tests, browser-native selection/cut behavior, drag/trim, or persistence/Undo in Chrome. Claude's script results remain prior evidence, not tests independently passed by this review.

Ship after fixing the sound-selection deletion target and cut navigation, implementing the requested preview modifier-click behavior, and rerunning those browser cases plus multi-delete Undo/Redo and typing-focus checks.

## Round 2 — 2026-11-07

**Verdict: ship.** Reviewed HEAD `d7bac40c742679c207f2de5c186cbb60f05689d4`. The three Round 1 blockers are resolved; no new blocking defect found in the added Q/W or zoom paths. This verdict supersedes the earlier verdict for the current commit. Browser and production-build verification limits are stated below.

### Original blockers

1. **Stale group / wrong Delete target: fixed.** `editor-tools.tsx:1486` derives the operative group from `sel`, so clearing the clip/text selection makes retained keys inert. The Sound toolbar also explicitly clears the keys (`:1801`), and the sound selection callback clears both states. Returning to a clip/text through `pick` starts from the operative group, preventing old keys from reappearing. An executable check of the current `remove` body with `sel = null`, stale keys, and a selected sound called sound deletion once and group deletion zero times. Claude's reported “open Sound then Delete” test covers the chooser state; this additional direct check covers the selected-sound branch that caused the original finding.
2. **Internal split navigation: fixed.** The cut list now includes `pieceSpans(g)` offsets (`editor-tools.tsx:572`), so internal cuts are represented with speed-aware timeline positions. A direct check of the current cut-list expression included an internal split at timeline 4 s for a clip starting at 3 s with speed 2. Both navigation directions use this same list. Gap/clip-edge handling is retained.
3. **Preview modifier-click: fixed.** WholePlayer → WholeMedia → TextOverlay now passes the text selection callback. `run-preview.tsx:468` handles Ctrl, Cmd and Shift before reading drag geometry or installing movement listeners, and stops propagation/default behavior. Direct execution of this branch confirmed selection with `add = true` for all three modifiers. Ordinary preview dragging remains on its prior path; the phone preview and step 5 do not receive this optional selection callback.

### New keys

- **Q/W:** reviewed `trimTo` (`editor-tools.tsx:1635`) and its key dispatch. Direct checks passed the Text C sequence 9–12 → Q at 10 → W at 11 = 10–11; out-of-range and too-short no-ops; multi-selection no-op; speed-aware file-time conversion; leaving other pieces untouched; selected-piece mismatch and noneditable guards; and the magnet-off hold flag. Every accepted trim made one history call; rejected trims made none. The existing `onParts` path handles caption remapping, containment and persistence, while the existing snapshot restores the pre-trim state. Text trim uses `onPatchText`. Q/W retain the specified one-piece scope; they do not remove all earlier/later pieces of a split clip. With a sound selected and no clip/text selection, Q/W fall back to the video piece under the playhead, as the supplied specification permits.
- **Keyboard zoom:** Ctrl/Cmd with `=`, `+` or `-` calls the same bounded 1–8 zoom update used by the toolbar. The existing typing, active-player and unrelated-dialog guards still run first, and handled keys prevent browser zoom. Step 5 has no zoom/trim callbacks, so it does not acquire these editor-only actions.
- **Wheel zoom:** the editor-root listener is non-passive, calls `preventDefault` for Ctrl/Cmd wheel, and is removed on cleanup. Direct checks passed zoom in/out, bounds 1–8, and unmodified-wheel fallthrough. This intentionally intercepts modifier-wheel anywhere inside the editor, including settings fields; unlike keyboard shortcuts, it has no typing-target exemption. Horizontal-only events (`deltaY = 0`) take the zoom-out branch, a minor polish issue rather than a blocker.

### Remaining limitations

The prior nonblocking limitations remain: selecting every hook piece preserves the entire hook; Ctrl+A excludes sounds; group copy copies one item and group cut is disabled; Ctrl+Shift+B still aliases ordinary split; frame stepping is fixed at 30 fps with end clamping; initial delete state comes from the rendered run. Q/W and zoom close some parity gaps, but this is still not a complete CapCut shortcut implementation. The Round 1 statements that preview modifier-selection, internal-cut navigation, Q/W and zoom are missing are superseded by this round.

### Validation

- `npx tsc --noEmit`: passed.
- Targeted ESLint on editor-tools, run-preview and run-view: passed.
- Temporary direct harness using current extracted function bodies and actual timeline helpers: passed the selection/trim/navigation/wheel checks above. The original deletion assertions also passed again for grouped pieces, cross-clip deletions, gaps, both magnet modes, partial hook removal, text containment and one save. The original harness's final printed navigation example uses its old hard-coded cut formula; it is not a test of the corrected handler. The separate Round 2 check evaluates the current expression.
- `npm run build`: **not independently verified this round**. Turbopack failed while processing CSS because its worker could not bind a port: `Operation not permitted (os error 1)`. This is a sandbox restriction, not evidence of a compilation defect. Claude reports a passing build outside this restriction.
- Windows Node/CDP was attempted again and failed before Chrome testing with `WSL ... UtilBindVsockAnyPort ... socket failed 1`. Claude's reported fresh-seed Chrome results are supporting evidence, not independently reproduced results here. Full browser Undo/Redo, focus/native-browser behavior, drag/trim and persisted reload were not rerun by this reviewer.

Only this review document was edited during Round 2. No application changes, commit or push.
