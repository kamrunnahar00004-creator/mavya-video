// Which job the render worker runs next (render/server.mjs next()). Upload copies first: the editor plays them and an
// export of uploaded clips waits for their working copies anyway (Codex 2026-11-06: a preview queued behind exports).
// Bounded, so a burst of uploads never holds an export back for long: copies and waiting exports take turns, one each
// (a copy can take minutes). One job at a time (the server has 512 MB).

/**
 * @param {number} exportsWaiting
 * @param {number} copiesWaiting
 * @param {number} copiesInARow  copies run since the last export
 * @returns {"copy" | "export" | null}
 */
export function nextJob(exportsWaiting, copiesWaiting, copiesInARow) {
  if (!exportsWaiting && !copiesWaiting) return null;
  return copiesWaiting && (!exportsWaiting || copiesInARow < 1) ? "copy" : "export";
}
