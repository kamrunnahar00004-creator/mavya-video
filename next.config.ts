import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // No Next.js dev badge in the corner (it shows up in screenshots of the app).
  devIndicators: false,
  partialPrefetching: true,
  // ffmpeg (hook clips, sound extraction): keep the package as is and ship its binary with the
  // routes that run it, or the deployed functions have no ffmpeg.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    // Hook generation also reads the character photos and their ready-made faces (src/lib/server/face-ref.ts).
    "/api/runs/*/generate": ["./node_modules/ffmpeg-static/ffmpeg", "./public/characters/*.jpg", "./public/characters/faces/*.jpg"],
    "/api/internal/generations": ["./node_modules/ffmpeg-static/ffmpeg", "./public/characters/*.jpg", "./public/characters/faces/*.jpg"],
    "/api/sounds/*": ["./node_modules/ffmpeg-static/ffmpeg"],
    // My files' still pictures (src/lib/server/thumbs.ts).
    "/api/media/*/thumb": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/uploads": ["./node_modules/ffmpeg-static/ffmpeg"],
    // The fast export lane (src/lib/server/fast-export.ts).
    "/api/internal/export-step": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/internal/export-run": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
