import Link from "next/link";

/** The marketing pages' logo, floating header and footer (landing and pricing). */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-[15px] font-semibold text-white">M</span>
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
