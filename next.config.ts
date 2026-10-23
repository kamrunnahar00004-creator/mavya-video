import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // No Next.js dev badge in the corner (it shows up in screenshots of the app).
  devIndicators: false,
  partialPrefetching: true,
  // ffmpeg (first-frame grabs for hooks, sound extraction): keep the package as is and ship its binary with the
  // routes that run it, or the deployed functions have no ffmpeg.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/runs/*/generate": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/internal/generations": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/sounds/*": ["./node_modules/ffmpeg-static/ffmpeg"],
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
