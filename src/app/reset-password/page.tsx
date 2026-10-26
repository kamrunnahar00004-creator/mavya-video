import { Suspense } from "react";
import type { Metadata } from "next";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata: Metadata = { title: "Reset password · Mavya" };

/** Where the reset email lands (through /auth/callback, which signs the person in for this one change). */
export default function ResetPassword() {
  return (
    <div className="landing-theme min-h-full bg-bg">
      <Suspense>
        <MarketingHeader />
      </Suspense>
      <main className="mx-auto max-w-[460px] px-5 pb-24 pt-16 sm:pt-20">
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </main>
      <MarketingFooter />
    </div>
  );
}
