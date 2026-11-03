import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import localFont from "next/font/local";
import Script from "next/script";
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
// Microsoft Clarity session recordings and heatmaps: shows where visitors stop, not just how many came (the same
// project the earlier mavya.app used). The id is public, it ships in the page anyway.
const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? "x97det48lq";

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
        {/* Vercel Web Analytics (visitors and page views, no cookies). */}
        <Analytics />
        {CLARITY_PROJECT_ID && (
          <Script id="clarity-init" strategy="afterInteractive">
            {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${CLARITY_PROJECT_ID}");`}
          </Script>
        )}
      </body>
    </html>
  );
}
