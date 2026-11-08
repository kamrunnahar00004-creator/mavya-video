/**
 * Stale-save guard (founder 2026-11-08: five demo captions vanished after a hook change). Every editor save sends the
 * whole caption list (and the whole hook and demo), so a page holding an older copy of the video, such as a second
 * tab or a page opened before the captions were added, wrote its old list over the new one. Now each editor save
 * carries the version of the video it was made from (`base`); the server refuses it when the video has changed
 * since (409), and that page loads the latest version instead of overwriting it.
 */

/** The run sections only the editor writes; a save with any of them is checked and gets a new version. */
export const EDIT_KEYS = ["hook", "demo", "texts", "sounds", "sound"] as const;

export const STALE_MESSAGE = "This video was changed in another tab or window. Loading the latest version.";

/** True when the save writes editor sections. */
export function touchesEdit(body: object): boolean {
  return EDIT_KEYS.some((k) => k in body);
}

/**
 * True when the save was made from an older copy: the video has a version and the save's `base` is not it (a page
 * from before versions existed sends none, and is refused too). A video with no version yet takes any save.
 */
export function staleEdit(current: string | undefined | null, base: unknown, lastSave?: string | null, mine?: unknown): boolean {
  if (!current) return false;
  if (base === current) return false;
  // The version came from one of this page's own saves whose answer was lost: its retry is not an older copy.
  return !(lastSave && ownSaves(mine).includes(lastSave));
}

/** The page's unanswered save ids, as sent (at most 20 short strings; anything else is ignored). */
export function ownSaves(mine: unknown): string[] {
  return Array.isArray(mine) ? mine.filter((x): x is string => typeof x === "string" && x.length <= 64).slice(0, 20) : [];
}

/** A save id, as sent (a short string), or null. */
export function saveIdOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
}

/**
 * The refused save's version was replaced only by a finished generation (which keeps the version it followed as
 * editPrev and no save id): not another copy, so the page saves its edits again on the generation's version instead of
 * reloading. Anything else (another copy saved, before or after the generation) means: load the latest.
 */
export function byGeneration(run: { editSave?: string | null; editPrev?: string | null } | null | undefined, base: unknown): boolean {
  return Boolean(run && !run.editSave && run.editPrev && run.editPrev === base);
}
