/**
 * The hook cache serves only clips the founder approved (founder 2026-11-08: "from now, let me decide which one is
 * served as cache"). A first Generate on a library hook + character gets one of these, if one matches; anything else
 * (and every Regenerate or Generate after Replace) makes a new clip. To approve a clip, add its generation id here.
 */
export const APPROVED_HOOK_CLIPS: readonly string[] = [
  // Founder 2026-11-26: only the Kling 4.0 + face ref clips he approved on 2026-11-22 (all Olivia); the earlier
  // Kling 3.0 clips (cc4afb16, 3980486e) are no longer served.
  "e587ac8b-8c34-44ec-bce8-e2090ecd4bab", // @blair.buildsthingss "Omg I love it!"
  "24318634-f520-487c-a3e9-9f7d1c78be0d", // @blair.buildsthingss "She's funny"
  "68079f04-d468-4882-b145-c5c878ec8075", // @tapsheet.marg "Greatest invention of 2026"
  "02711cc1-6b6e-4820-927d-26cd62a03103", // @creativeinezz "So strange like whatt"
  "a50ff688-667b-4827-a71b-d832b244a636", // @rash.earns "walking red flag"
  "3039ce55-7ab8-4c79-9846-1370660ac61b", // @createwith_megz "It's not that hard!"
  "48ee5ebf-b5f6-4ef5-a29f-27b76a95e163", // @mamoni_ai_tools
];
