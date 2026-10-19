import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms · Mavya", description: "The terms for using Mavya." };

const SECTIONS: LegalSection[] = [
  {
    title: "Using Mavya",
    body: [
      "Mavya helps you make short-form videos: pick a hook, recreate it with a character, add your demo, text and sound, and export. By creating an account or using Mavya you agree to these terms.",
      "You must be at least 18, and the information you give us must be accurate. You are responsible for your account and everything done with it.",
    ],
  },
  {
    title: "Plans and payment",
    body: [
      "Paid plans renew automatically each month or year until you cancel. You can cancel anytime in Billing; your plan stays active until the end of the period you paid for.",
      "Each plan includes a monthly number of AI video hooks. Unused hooks do not roll over. Payments are processed by Stripe.",
      "Studio includes guidance from a short-form expert. Business is a separate service agreed in writing before it starts.",
    ],
  },
  {
    title: "Your content",
    body: [
      "You keep the rights to what you upload: your demos, photos, audio and text. You give us permission to store and process it only to run Mavya for you, including sending it to the AI providers that generate your hooks.",
      "You confirm you have the rights to everything you upload, including the consent of anyone who appears in it, and that you have the rights to any music you publish with your videos.",
    ],
  },
  {
    title: "What you can't do",
    body: [
      "Don't use Mavya to impersonate a real person, make fake testimonials or reviews, mislead people about a product, or create anything illegal, hateful or sexual.",
      "Don't upload someone's face without their consent. Don't try to break, overload or copy the service.",
      "Follow the rules of the platforms you post to, including labeling AI-generated content where they require it.",
    ],
  },
  {
    title: "AI output",
    body: [
      "AI-generated hooks can contain mistakes. Review every video before you post it. Views and results are never guaranteed.",
    ],
  },
  {
    title: "Ending your account",
    body: [
      "You can stop using Mavya and delete your account at any time. We may suspend accounts that break these terms.",
    ],
  },
  {
    title: "Liability",
    body: [
      "Mavya is provided as is. To the extent the law allows, we are not liable for indirect losses, and our total liability is limited to what you paid us in the last 12 months.",
    ],
  },
  {
    title: "Changes and contact",
    body: [
      "We may update these terms; we will tell you about important changes before they apply. Questions: hello@mavya.app.",
    ],
  },
];

export default function Terms() {
  return <LegalPage title="Terms" updated="October 19, 2026" sections={SECTIONS} />;
}
