/**
 * The hook cache serves only clips the founder approved (founder 2026-11-08: "from now, let me decide which one is
 * served as cache"). A first Generate on a library hook + character gets one of these, if one matches; anything else
 * (and every Regenerate or Generate after Replace) makes a new clip. To approve a clip, add its generation id here.
 */
export const APPROVED_HOOK_CLIPS: readonly string[] = [
  // Olivia + @blair.buildsthingss DaFCnEnNxTM ("nerdy guy at work…"), camera prompt test, founder: "PERFECT".
  "cc4afb16-d2cc-446f-b9fa-ba09688dc4df",
  // Sienna + @creativewithankita100 (typing sleepily, then gasps and pushes up her sleep mask), founder: "good".
  "3980486e-aac4-4c6c-b4cb-e651a5d56f86",
];
