import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import localFont from "next/font/local";
import { Anton, Bebas_Neue, Geist, Geist_Mono, Montserrat, Permanent_Marker, Poppins } from "next/font/google";
import "./globals.css";

// UI type: Satoshi (Fontshare, free for commercial use), self-hosted.
const satoshi = localFont({
  variable: "--font-satoshi",
  src: [
    { path: "../fonts/Satoshi-400.woff2", weight: "400" },
    { path: "../fonts/Satoshi-500.woff2", weight: "500" },
    { path: "../fonts/Satoshi-700.woff2", weight: "700" },
    { path: "../fonts/Satoshi-900.woff2", weight: "900" },
  ],
});
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Caption fonts for text overlays.
const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400" });
const bebas = Bebas_Neue({ variable: "--font-bebas", subsets: ["latin"], weight: "400" });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["700", "900"] });
const marker = Permanent_Marker({ variable: "--font-marker", subsets: ["latin"], weight: "400" });
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["600", "800"] });

export const metadata: Metadata = {
  title: "Mavya: viral hook + demo videos",
  description: "Steal hooks that already went viral, put an AI character in them, add your product demo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const fonts = [satoshi, geistSans, geistMono, anton, bebas, montserrat, marker, poppins].map((f) => f.variable).join(" ");
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
