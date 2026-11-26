// Guides (founder 2026-11-26): step-by-step how to use Mavya, with real screenshots (public/guides/*.webp, taken from
// the app itself). Shown at /guides, under Videos in the sidebar.

export type GuideStep = { title: string; text: string; image: string; alt: string };
export type Guide = { id: string; title: string; summary: string; steps: GuideStep[] };

export const GUIDES: Guide[] = [
  {
    id: "first-video",
    title: "Make your first video",
    summary: "From a viral hook to a finished reel for your app.",
    steps: [
      { title: "Start a video", text: "Go to Videos and click New video.", image: "/guides/videos.webp", alt: "The Videos page with the New video button" },
      { title: "Add your product", text: "Paste your app's link and click Analyze. Mavya reads your site, so the script fits your app.", image: "/guides/product.webp", alt: "Step 1, Your product, with the link box and Analyze" },
      { title: "Pick a hook that already works", text: "Click Browse hooks and pick one with millions of views. You can also upload a video or describe a hook.", image: "/guides/browse.webp", alt: "The hook library with view counts" },
      { title: "Choose your character", text: "Pick a face from the library, upload your own photo, or describe one.", image: "/guides/character.webp", alt: "Step 3, Choose your character" },
      { title: "Generate your hook", text: "Click Generate. In about two minutes your character acts out the hook. Not right? Click Regenerate and say what to fix. Rate it with thumbs up or down.", image: "/guides/generate.webp", alt: "Step 4, the generated hook with Replace and Regenerate" },
      { title: "Add your demo", text: "Film your app on your phone, shot by shot, then add the clips. Each clip can be trimmed and given its own text.", image: "/guides/demo.webp", alt: "Step 5, the demo clips" },
      { title: "Add sound", text: "Keep the hook's original sound, pick a trending song, or upload your own.", image: "/guides/sound.webp", alt: "Step 6, the chosen song and its waveform" },
      { title: "Edit and export", text: "Click Edit video to fine-tune clips, text and timing on the timeline. When it looks right, click Export to download your reel.", image: "/guides/editor.webp", alt: "The video editor timeline" },
    ],
  },
  {
    id: "calendar",
    title: "Plan and post with the Content calendar",
    summary: "Ready captions for Instagram, Facebook, TikTok and YouTube Shorts.",
    steps: [
      { title: "Add your app once", text: "Open Your app & captions, paste your link and click Analyze. Mavya picks hashtags for your niche. Each platform gets its own caption format.", image: "/guides/calendar-captions.webp", alt: "Your app & captions, with hashtags and the caption format" },
      { title: "Add videos to the calendar", text: "Click Add videos, pick your exported videos and when to post them. Check the captions, then save.", image: "/guides/calendar-add.webp", alt: "Add videos, picking exported videos" },
      { title: "Post it and mark it", text: "Open a post, download the video and copy the caption. Post it, then tick I posted it and add the link and views.", image: "/guides/calendar-post.webp", alt: "An opened post with its caption, Copy and I posted it" },
      { title: "See your week", text: "Every planned and posted video, day by day, with its views.", image: "/guides/calendar.webp", alt: "The Content calendar week view" },
    ],
  },
];
