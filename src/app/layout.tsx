import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import localFont from "next/font/local";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// UI type: Satoshi (Fontshare, free for commercial use), self-hosted.
const satoshi = localFont({
  variable: "--font-satoshi",
  display: "swap",
  src: [
    { path: "../fonts/Satoshi-400.woff2", weight: "400" },
    { path: "../fonts/Satoshi-500.woff2", weight: "500" },
    { path: "../fonts/Satoshi-700.woff2", weight: "700" },
    { path: "../fonts/Satoshi-900.woff2", weight: "900" },
  ],
});
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
export const metadata: Metadata = {
  title: "Mavya: viral hook + demo videos",
  description: "Steal hooks that already went viral, put an AI character in them, add your product demo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const fonts = [satoshi, geistSans, geistMono].map((f) => f.variable).join(" ");
  return (
    <html lang="en" className={`${fonts} h-full antialiased`}>
      <body className="h-full">
        {children}
        {/* Vercel Speed Insights (real-user page speed, Vercel Pro). */}
        <SpeedInsights />
      </body>
    </html>
  );
}
