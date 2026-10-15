import type { Adjust } from "@/lib/adjust";
import type { FontKey, TextStyle } from "@/lib/studio-data";

export type Platform = "tiktok" | "instagram" | "youtube" | "other";
export type Role = "hook" | "body" | "cta";

export type Segment = {
  start: number;
  end: number;
  role: Role;
  /** What happens in this part, e.g. "Shocked reaction" or "Laptop demo". */
  note: string;
  /** Small JPEG data URL captured at the segment's midpoint. */
  thumb?: string;
};

export type Analysis = {
  duration: number;
  width: number;
  height: number;
  /** Detected scene cuts, in seconds. */
  cuts: number[];
  segments: Segment[];
  analyzedAt: string;
};

export type Reference = {
  id: string;
  title: string;
  platform: Platform;
  sourceUrl: string;
  views: number | null;
  /** Empty for link-only references (pasted URL, no file). */
  mediaId: string;
  mime: string;
  createdAt: string;
  analysis: Analysis | null;
  /** "curated" = in the hook library; "user" = pasted or uploaded by a user for one run. */
  owner?: "curated" | "user";
  niche?: string;
  hookStyle?: string;
  /** Thumbnail from the platform's official oEmbed, for link references. */
  thumbUrl?: string;
  author?: string;
  likes?: number | null;
  comments?: number | null;
  caption?: string;
  /** Two-line description of the video for the library preview (scripts/curation/summarize.py). */
  summary?: string;
  /** Production recipe (scripts/curation/recipe.py); only the parts the app reads are typed. */
  recipe?: { onScreenText?: { text: string }[]; hook?: { end?: number }; demo?: { label: string; hint?: string; seconds?: number; camera?: string; steps?: string[]; text?: string }[] };
  postedAt?: string;
  /** Curated but not yet fit-checked: hidden from users. */
  pending?: boolean;
  /** The founder's keep/drop label: the training data for the AI fit check. Dropped hooks are hidden, not deleted. */
  review?: { verdict: "keep" | "drop"; reason?: string; at: string };
  /** AI fit check (scripts/curation/fitcheck.py). style: does a person speak, or text + music only. */
  ai?: { verdict: "match" | "flag"; reason: string; product?: string; style?: "talking" | "text_music"; model: string; at: string };
  /** Creator's follower count when the hook was saved. */
  followers?: number;
};

/** Like rate under 0.3% means most views came from ads (the API excludes likes on ads). */
export function isLikelyBoosted(r: Pick<Reference, "views" | "likes">): boolean {
  return !!r.views && r.likes != null && r.likes / r.views < 0.003;
}

/** "Comment CRAB for the link" style call to action, if the caption has one. */
export function commentCta(caption?: string): string | null {
  const m = caption?.match(/comment\s+["“”']?([A-Za-z0-9]{2,20})["“”']?/i);
  return m && !/^(below|if|and|for|down|your|what|this|the)$/i.test(m[1]) ? m[1].toUpperCase() : null;
}

/** A file the user uploaded (clips, screen recordings, photos, music). */
export type Asset = {
  mediaId: string;
  name: string;
  kind: "video" | "image" | "audio";
  createdAt: string;
};

/* ---------- Timeline (CapCut-style editor) ---------- */

/** A clip on the main video track. Its length on the timeline is (out - in) / speed. */
export type VClip = {
  id: string;
  mediaId: string | null;
  kind: ClipKind;
  name: string;
  tones?: [string, string];
  /** Source in/out points, in seconds. */
  in: number;
  out: number;
  /** Source length; null for images and placeholders (any length). */
  srcLength: number | null;
  speed: number;
  /** Percent, 100 = fill the frame. */
  scale: number;
  /** Offset in percent of the frame. */
  x: number;
  y: number;
  rotate: number;
  volume: number;
  frame?: Frame;
  /** Transform keyframes, t in seconds from the clip's start on the timeline. */
  keys?: VKey[];
};

export type VKey = { t: number; scale: number; x: number; y: number; rotate: number };
export type TKey = { t: number; x: number; y: number; size: number };

export type TItem = TextLayer & { row: number; keys?: TKey[] };

export type AClip = { id: string; mediaId: string; name: string; start: number; in: number; out: number; srcLength: number | null; volume: number };

export type Timeline = {
  v: 2;
  productName: string;
  refId: string | null;
  refMediaId: string | null;
  refTitle: string;
  clips: VClip[];
  texts: TItem[];
  audio: AClip[];
};

/* ---------- Editor project ---------- */

export type ClipKind = "video" | "image" | "placeholder";
export type Clip = {
  mediaId: string | null;
  name: string;
  kind: ClipKind;
  offset: number;
  length: number | null;
  /** Placeholder clips (AI avatar not connected yet) render as a gradient. */
  tones?: [string, string];
};
export type Frame = "none" | "laptop" | "overlay";
export type Slot = {
  id: string;
  role: Role;
  duration: number;
  suggestion: string;
  refStart: number | null;
  refThumb?: string;
  clip: Clip | null;
  frame?: Frame;
};
export type TextLayer = {
  id: string;
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
  /** A built-in FontKey or a Google Fonts family name (see FONT_CHOICES). */
  font: string;
  color: string;
  style: TextStyle;
  /** Second color for the style (outline / box / glow / shadow). Absent = automatic contrast. */
  second?: string;
};
export type Project = {
  productName: string;
  refId: string | null;
  refMediaId: string | null;
  refTitle: string;
  slots: Slot[];
  texts: TextLayer[];
};

/* ---------- Runs ---------- */

export type HookMode = "upload" | "avatar";
export type TextPos = "top" | "center" | "bottom";
/** Which face goes on the hook: the user's photo or one of the AI faces (face swap, not connected yet). */
export type Face = { kind: "photo"; mediaId: string } | { kind: "ai"; index: number } | { kind: "character"; id: string } | { kind: "described"; text: string };
export type Run = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceRefId: string | null;
  hook: {
    mode: HookMode;
    /** Final on-screen hook text (remixed for the product). */
    text: string;
    clip: Clip | null;
    avatarIndex: number | null;
    variationIndex: number | null;
    /** Part of the source video used as the hook, in seconds. */
    start?: number;
    end?: number;
    /** On-screen text of the source hook, typed by the user for now. */
    original?: string;
    face?: Face | null;
    textPos?: TextPos;
    /** Free placement and look of the hook text, set directly on the preview. */
    textX?: number;
    textY?: number;
    textSize?: number;
    font?: FontKey;
    color?: string;
    textStyle?: TextStyle;
    /** Where the hook comes from: the library, the user's own upload, or their own description. */
    source?: "library" | "upload" | "describe";
    /** Upload: optional context (what to keep or change). */
    note?: string;
    /** Describe: the hook the user wants their character to do. */
    describe?: string;
    /** Describe: the user confirmed it ("Use this hook"). */
    describeReady?: boolean;
    /** Step 2: which inline option is open (upload a photo / describe a character). */
    faceMode?: "upload" | "describe";
    /** Step 3: the generated hook clip (a sample clip until Runway is connected). */
    generated?: { src: string; seconds: number; at: string; /** What the user said went wrong when regenerating. */ note?: string };
    /** Step 3 Advanced settings: brightness / contrast / saturation / warmth / zoom of the hook clip. */
    adjust?: Partial<Adjust>;
  };
  demo: {
    /** Older runs: a single demo clip. Newer runs use clips. */
    clip: Clip | null;
    frame: Frame;
    /** Step 4: one finished demo video, or a shot list filmed clip by clip. */
    mode?: "single" | "clips";
    clips?: DemoClip[];
  };
  /** Step 5: the sound under the whole video (the hook's own sound, a real song's 30s clip, or the user's file). */
  sound?: {
    kind: "hook" | "song" | "upload";
    src: string;
    name: string;
    /** The hook's sound: the reference it comes from. */
    refId?: string;
    /** Where in the sound it starts playing, seconds (the "Song part"). */
    start: number;
    /** Its bar on the video timeline: plays from video time `at` (default 0) until `end` (default the end of the video). */
    at?: number;
    end?: number;
    /** 0..100 */
    volume: number;
    length?: number;
  } | null;
  /** Older split-sound runs (2026-10-15 only): the first piece is read as the main song. */
  sounds?: SoundPiece[];
  /** Step 5: parts of the video (by timeline id: "hook" or a demo clip id) that play their own song instead of the main one. */
  partSounds?: Record<string, PartSound>;
  /** Step 5: parts with no music: "voice" plays the clip's own sound (someone talking), "mute" is silent. */
  partModes?: Record<string, "voice" | "mute">;
  /** On-screen texts with timing. The one with id "hook" mirrors hook.text. Absent on older runs. */
  texts?: TextLayer[];
  /** Editor state. Older runs may hold the slot-based Project; the editor rebuilds those. */
  project: Timeline | Project | null;
};

/** One demo clip. In "clips" mode it starts as a shot-list entry (label + hint) and gets a video when uploaded. */
export type DemoClip = {
  id: string;
  label: string;
  /** What to film (guidance, optional). Older shot lists only have this one line. */
  hint?: string;
  /** Camera setup, e.g. "Phone over your shoulder, screen fills the frame". */
  camera?: string;
  /** What to do, in order. */
  steps?: string[];
  /** Suggested on-screen text for this clip (a sample now; written by AI from the user's product later). */
  text?: string;
  /** Suggested on-screen length, seconds. */
  target?: number;
  mediaId?: string;
  name?: string;
  /** File length; start / end trim it. */
  seconds?: number;
  start?: number;
  end?: number;
  adjust?: Partial<Adjust>;
};

/** A chosen sound: the hook's own sound, a real song's 30s clip, or the user's file. */
export type PartSound = {
  kind: "hook" | "song" | "upload";
  src: string;
  name: string;
  refId?: string;
  /** Where inside the sound it starts (which part plays). */
  start: number;
  /** 0..100 */
  volume: number;
  length?: number;
};

/** One piece of the sound under the video, as played (built from the main song and the parts' own songs). */
export type SoundPiece = {
  id: string;
  kind: "hook" | "song" | "upload";
  src: string;
  name: string;
  refId?: string;
  /** Video time where this sound starts playing, and where it stops (default: where the next sound starts, or the end). */
  at: number;
  end?: number;
  /** Where inside the sound it starts (which part plays). */
  start: number;
  /** 0..100 */
  volume: number;
  length?: number;
};

export const ROLE_LABEL: Record<Role, string> = { hook: "Hook", body: "Demo", cta: "CTA" };
export const ROLE_COLOR: Record<Role, string> = { hook: "#f97316", body: "#0ea5e9", cta: "#22c55e" };
export const PLATFORM_LABEL: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", other: "Other" };

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
}

export function fmtViews(n: number | null): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
