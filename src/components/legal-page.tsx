import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";

export type LegalSection = { title: string; body: string[] };

/** Terms and Privacy: one plain reading column between the marketing header and footer. */
export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: LegalSection[] }) {
  return (
    <div className="landing-theme min-h-full bg-bg">
      <MarketingHeader />
      <main className="mx-auto max-w-[720px] px-5 pb-24 pt-16 sm:pt-20">
        <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">{title}</h1>
        <p className="mt-3 text-[14px] text-soft">Last updated {updated}</p>
        {sections.map((s) => (
          <section key={s.title} className="mt-10">
            <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{s.title}</h2>
            {s.body.map((p) => (
              <p key={p} className="mt-3 text-[16px] leading-[1.7] text-muted">{p}</p>
            ))}
          </section>
        ))}
      </main>
      <MarketingFooter />
    </div>
  );
}
