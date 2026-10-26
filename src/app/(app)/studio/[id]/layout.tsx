import { TikTok_Sans, Anton, Bebas_Neue, Montserrat, Permanent_Marker, Poppins } from "next/font/google";
const tiktok = TikTok_Sans({ variable: "--font-tiktok-sans", subsets: ["latin"], weight: "800", display: "swap", adjustFontFallback: false });
// Caption fonts for text overlays.
const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400" });
const bebas = Bebas_Neue({ variable: "--font-bebas", subsets: ["latin"], weight: "400" });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["700", "900"] });
const marker = Permanent_Marker({ variable: "--font-marker", subsets: ["latin"], weight: "400" });
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["600", "800"] });

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <div data-editor-fonts className={[tiktok, anton, bebas, montserrat, marker, poppins].map(f => f.variable).join(" ") + " h-full"}>{children}</div>;
}
