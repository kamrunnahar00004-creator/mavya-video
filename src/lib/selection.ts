import { rowOf, shiftSounds } from "@/lib/sound";
import type { SoundPiece, TextLayer } from "@/lib/types";

/**
 * The editor's group selection (Ctrl/Cmd/Shift-click, Ctrl+A), as pure functions so they can be tested. Keys:
 * "c:<clip>:<piece>", "t:<text>", "s:<sound>".
 */

/** Ctrl/Cmd/Shift-click on `k`: it joins the selection, or leaves it if it was in. */
export function toggleInGroup(current: string[], k: string): string[] {
  return current.includes(k) ? current.filter((x) => x !== k) : [...current, k];
}

/**
 * The group that Delete, copy and cut act on: the kept keys while there are at least two, the sound chooser is not
 * open over existing sounds, and no sound was picked on its own after the group (a sound picked or added after a
 * group clears the clip/text selection; the old group must never be what Delete removes, Codex 2026-11-07).
 */
export function activeGroup(keys: string[], state: { selected: boolean; soundSelected: boolean; choosing: boolean; hasSounds: boolean }): string[] {
  if (keys.length < 2) return [];
  if (state.choosing && state.hasSounds) return [];
  if (!state.selected && state.soundSelected) return [];
  return keys;
}

/** A copied clip piece's old timeline place. */
export type GroupClip = { lo: number; len: number };

/**
 * Where a copied group's texts and sounds go when it is pasted: copied clips go in back to back from `anchor`; a time
 * inside a copied clip lands at the same point of its copy; before the first copied clip it keeps its distance before
 * it (not below 0); between copied clips it follows the one before it, never past the next copy's start; without
 * clips everything keeps its distance from the group's start `base` (Codex 2026-11-07: layers of non-adjacent clips).
 */
export function groupPlacer(clips: GroupClip[], base: number, anchor: number): (x: number) => number {
  const starts = clips.map((_, k) => anchor + clips.slice(0, k).reduce((t, c) => t + c.len, 0));
  return (x) => {
    if (!clips.length) return anchor + (x - base);
    const k = clips.findIndex((c) => x >= c.lo && x < c.lo + c.len);
    if (k >= 0) return starts[k] + (x - clips[k].lo);
    if (x < clips[0].lo) return Math.max(0, anchor + (x - clips[0].lo));
    const j = clips.reduce((m, c, i) => (c.lo + c.len <= x ? i : m), 0);
    const after = starts[j] + clips[j].len + (x - (clips[j].lo + clips[j].len));
    return j + 1 < clips.length ? Math.min(after, starts[j + 1]) : after;
  };
}

/** Pasted sounds: each copied row gets a new row of its own after `existingRows`, so overlapping sounds stay whole. */
export function pastedRows(existingRows: number[], copiedRows: number[]): (row: number) => number {
  const first = Math.max(-1, ...existingRows) + 1;
  const rows = [...new Set(copiedRows)].sort((a, b) => a - b);
  return (row) => first + rows.indexOf(row);
}

/**
 * A copied group's texts and sounds as pasted (the clips go in separately, back to back from `anchor`): each lands on
 * the copy of the clip it was on (groupPlacer); copied sounds get rows of their own after the existing ones
 * (pastedRows), so overlapping sounds keep their length; the existing sounds after the insert point `from` move by the
 * pasted clips' length, as the insert itself moves them (shiftSounds). `sounds` is null when no sound was copied.
 */
export function pasteGroupLayers(
  group: { clips: GroupClip[]; base: number; texts: TextLayer[]; sounds: { p: SoundPiece; len: number }[] },
  at: { anchor: number; from: number; existing: SoundPiece[]; explicitSounds: boolean; newId: () => string },
): { texts: { t: TextLayer; start: number; end: number }[]; sounds: SoundPiece[] | null } {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const place = groupPlacer(group.clips, group.base, at.anchor);
  const texts = group.texts.map((t) => {
    const start = r3(place(t.start));
    return { t, start, end: r3(start + (t.end - t.start)) };
  });
  if (!group.sounds.length) return { texts, sounds: null };
  const rowFor = pastedRows(at.existing.map(rowOf), group.sounds.map(({ p }) => rowOf(p)));
  const added = group.sounds.map(({ p, len }) => {
    const start = r3(place(p.at));
    return { ...p, id: at.newId(), at: start, end: r3(start + len), row: rowFor(rowOf(p)) };
  });
  const by = group.clips.reduce((t, c) => t + c.len, 0);
  const existing = group.clips.length && at.explicitSounds && Number.isFinite(at.from) ? shiftSounds(at.existing, at.from, by) : at.existing;
  return { texts, sounds: [...existing, ...added].sort((a, b) => a.at - b.at) };
}
