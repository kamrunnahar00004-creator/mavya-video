import Link from "next/link";
import { MAINTENANCE } from "@/lib/maintenance";

/** A five-point star path centred on (cx, cy). */
const star = (cx: number, cy: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    return `${i ? "L" : "M"}${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }).join("") + "Z";
const STARS = (
  [[5.6, 20.2, 1.1], [8.6, 19.9, 1.2], [5.9, 23.3, 1.25], [9, 23.6, 1.55], [12.2, 23, 1.15], [5.8, 26.7, 1.45], [9.2, 27, 1.25], [12.2, 26.5, 1]] as const
).map(([x, y, r]) => star(x, y, r)).join("");

/**
 * The Mavya mark: a violet tile with a rocket taking off, a trail of stars behind it (going viral).
 * `inverted`: white tile, violet rocket (for use on violet).
 */
export function MavyaMark({ className = "h-8 w-8", inverted = false }: { className?: string; inverted?: boolean }) {
  const tile = inverted ? "#ffffff" : "#7b4cfa";
  const ink = inverted ? "#7b4cfa" : "#ffffff";
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill={tile} />
      <g transform="translate(18.6 14) rotate(45) scale(.9) translate(-16 -15)" fill={ink}>
        <path d="M16 2.5C21 6 22.3 11.5 21.6 17.5L21 21.5H11L10.4 17.5C9.7 11.5 11 6 16 2.5Z" />
        <path d="M10.6 13.5 6.8 18.2c-.4.5-.6 1.1-.6 1.7V24l4.9-3.2ZM21.4 13.5l3.8 4.7c.4.5.6 1.1.6 1.7V24l-4.9-3.2Z" />
        <circle cx="16" cy="11" r="2.3" fill={tile} />
        <path d="M16 26.4c-1.1-.7-1.8-1.3-1.8-2.1 0-.5.4-.9.9-.9.4 0 .7.2.9.5.2-.3.5-.5.9-.5.5 0 .9.4.9.9 0 .8-.7 1.4-1.8 2.1Z" />
      </g>
      <path d={STARS} fill={ink} />
    </svg>
  );
}

/** The marketing pages' logo, floating header and footer (landing and pricing). */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <MavyaMark />
      <span className="text-[18px] font-bold tracking-tight">Mavya</span>
    </Link>
  );
}

export function MarketingHeader({ active }: { active?: "pricing" }) {
  const link = (on: boolean) => `hover:text-text ${on ? "text-text" : ""}`;
  return (
    <header className="sticky top-0 z-30">
      {MAINTENANCE && (
        <p role="status" className="bg-accent px-4 py-2.5 text-center text-[14px] font-semibold text-white">
          We&apos;re doing some maintenance. Mavya will be back soon.
        </p>
      )}
      <div className="px-3 pt-3">
      <div className="mx-auto flex max-w-[1160px] items-center gap-6 rounded-xl border border-line bg-panel/85 px-5 py-2.5 shadow-[0_1px_2px_rgba(28,26,23,0.05),0_8px_24px_-12px_rgba(28,26,23,0.12)] backdrop-blur">
        <Logo />
        <nav className="ml-4 hidden items-center gap-5 text-[14px] font-semibold text-muted md:flex">
          <Link href="/#how" className={link(false)}>How it works</Link>
          <Link href="/pricing" className={link(active === "pricing")}>Pricing</Link>
          <Link href="/#faq" className={link(false)}>FAQ</Link>
        </nav>
        {!MAINTENANCE && (
          <div className="ml-auto flex items-center gap-3">
            <Link href="/login" className="text-[14px] font-semibold text-muted hover:text-text">
              Log in
            </Link>
            <Link href="/login" className="btn-primary px-4 py-2 text-[14px]">
              Sign up
            </Link>
          </div>
        )}
      </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-4 px-5 py-6 text-[13px] text-soft">
        <Logo />
        <span className="ml-auto">© 2026 Mavya</span>
        <Link href="/pricing" className="hover:text-text">Pricing</Link>
        <Link href="/terms" className="hover:text-text">Terms</Link>
        <Link href="/privacy" className="hover:text-text">Privacy</Link>
      </div>
    </footer>
  );
}
