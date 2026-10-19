import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy · Mavya", description: "How Mavya handles your data." };

const SECTIONS: LegalSection[] = [
  {
    title: "What we collect",
    body: [
      "Your account details (name, email). What you make in Mavya: uploaded videos, photos, audio, text and your video projects. Billing details are handled by Stripe; we never see your full card number.",
      "Basic usage data, such as pages visited and features used, to keep Mavya working and improve it.",
    ],
  },
  {
    title: "How we use it",
    body: [
      "To run Mavya: save your projects, generate your hooks, render your exports and manage your plan. To answer you when you contact us.",
      "We do not sell your data, and we do not use your uploads to advertise.",
    ],
  },
  {
    title: "Who processes it",
    body: [
      "We use trusted providers to run Mavya: hosting and storage, Stripe for payments, an email provider, and AI video providers that receive the inputs for a hook only when you click Generate.",
      "Each provider only gets what it needs for its part of the job.",
    ],
  },
  {
    title: "Faces and photos",
    body: [
      "If you upload a photo of a face, it is used only to make your videos. Only upload faces you have permission to use. Delete them anytime.",
    ],
  },
  {
    title: "How long we keep it",
    body: [
      "We keep your projects and files while your account is open. When you delete a file, a project or your account, we delete the related data, except what we must keep by law (such as payment records).",
    ],
  },
  {
    title: "Your choices",
    body: [
      "You can access, export, correct or delete your data at any time. Email hello@mavya.app and we will help within 30 days.",
    ],
  },
  {
    title: "Changes and contact",
    body: [
      "We may update this policy and will tell you about important changes. Questions: hello@mavya.app.",
    ],
  },
];

export default function Privacy() {
  return <LegalPage title="Privacy" updated="October 19, 2026" sections={SECTIONS} />;
}
