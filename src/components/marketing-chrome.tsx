import Link from "next/link";

/**
 * The Mavya mark: a violet tile with an M whose last stroke breaks out as a growth arrow (going viral).
 * `inverted`: white tile, violet glyph (for use on violet).
 */
export function MavyaMark({ className = "h-8 w-8", inverted = false }: { className?: string; inverted?: boolean }) {
  const tile = inverted ? "#ffffff" : "url(#mavya-tile)";
  const ink = inverted ? "#7b4cfa" : "#ffffff";
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="mavya-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9b6bff" />
          <stop offset="1" stopColor="#5b2fd6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={tile} />
      <path d="M7 24V11l6.5 7 5.5-6 6-6M19.5 6H25v5.5" fill="none" stroke={ink} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
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
    <header className="sticky top-0 z-30 px-3 pt-3">
      <div className="mx-auto flex max-w-[1160px] items-center gap-6 rounded-xl border border-line bg-panel/85 px-5 py-2.5 shadow-[0_1px_2px_rgba(28,26,23,0.05),0_8px_24px_-12px_rgba(28,26,23,0.12)] backdrop-blur">
        <Logo />
        <nav className="ml-4 hidden items-center gap-5 text-[14px] font-semibold text-muted md:flex">
          <Link href="/#how" className={link(false)}>How it works</Link>
          <Link href="/pricing" className={link(active === "pricing")}>Pricing</Link>
          <Link href="/#faq" className={link(false)}>FAQ</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/studio" className="text-[14px] font-semibold text-muted hover:text-text">
            Log in
          </Link>
          <Link href="/studio" className="btn-primary px-4 py-2 text-[14px]">
            Sign up
          </Link>
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
        <a href="#" className="hover:text-text">Terms</a>
        <a href="#" className="hover:text-text">Privacy</a>
      </div>
    </footer>
  );
}
