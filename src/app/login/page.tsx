import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginView } from "@/components/login-view";

export const metadata: Metadata = { title: "Sign in · Mavya" };

/** LoginView reads `?next=` and `?error=`, so it renders inside a Suspense boundary. */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-full bg-bg" />}>
      <LoginView />
    </Suspense>
  );
}
