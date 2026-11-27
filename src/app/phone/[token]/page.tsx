import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { readPhoneToken } from "@/lib/server/phone-link";
import { PhoneUpload } from "./phone-upload";

export const metadata: Metadata = { title: "Upload from phone · Mavya", robots: { index: false } };

/** The page the QR code opens on the phone (src/lib/server/phone-link.ts). */
export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={null}>
      <PhonePage params={params} />
    </Suspense>
  );
}

async function PhonePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const ok = Boolean(readPhoneToken(token));
  return (
    <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col px-5 py-8 text-text">
      <p className="text-[15px] font-bold">Mavya</p>
      {ok ? <PhoneUpload token={token} /> : (
        <p className="mt-10 text-[17px] font-semibold">This link expired. Scan the QR code again.</p>
      )}
    </main>
  );
}
