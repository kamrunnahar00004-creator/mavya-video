import Link from "next/link";

/** Settings: the title and the Profile / Billing tabs shared by both pages. */
export function SettingsHeader({ tab }: { tab: "profile" | "billing" }) {
  const item = (on: boolean) =>
    `-mb-px border-b-2 px-1 pb-3 text-[14.5px] font-semibold ${on ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`;
  return (
    <div>
      <h1 className="text-[26px] font-extrabold tracking-tight">Settings</h1>
      <nav className="mt-5 flex gap-6 border-b border-line" aria-label="Settings">
        <Link href="/settings" className={item(tab === "profile")} aria-current={tab === "profile" ? "page" : undefined}>
          Profile
        </Link>
        <Link href="/billing" className={item(tab === "billing")} aria-current={tab === "billing" ? "page" : undefined}>
          Billing
        </Link>
      </nav>
    </div>
  );
}
