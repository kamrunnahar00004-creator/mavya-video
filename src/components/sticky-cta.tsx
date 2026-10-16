"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PLANS } from "@/lib/plans";

/** Landing: a slim bar pinned to the bottom once the hero has scrolled away. */
export function StickyCta() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = () => setShown(window.scrollY > 700);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const from = Math.min(...PLANS.filter((p) => p.price > 0).map((p) => p.price));
  return (
    <div className={`fixed inset-x-3 bottom-4 z-30 transition-all duration-300 ${shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"}`}>
      <div className="mx-auto flex max-w-[1160px] items-center gap-4 rounded-2xl border border-line bg-panel/95 px-5 py-3 shadow-[0_12px_40px_-12px_rgba(21,18,31,0.3)] backdrop-blur">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-extrabold">Start free</div>
          <div className="truncate text-[12.5px] font-semibold text-soft">AI hooks from ${from} / month</div>
        </div>
        <Link href="/studio" className="btn-primary ml-auto shrink-0 px-5 py-2.5 text-[14px]">
          Make your first video
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
