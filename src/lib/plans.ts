/**
 * Plans: the pricing page and the Billing page both read these (one place to change them).
 * AI hooks are the cost (each is one generation); editing and exporting are not. No free plan.
 * Draft numbers until the founder sets them; checkout is not connected yet.
 */
export type PlanId = "starter" | "pro" | "studio";
export type BillingCycle = "monthly" | "annual";

export type Plan = {
  id: PlanId;
  name: string;
  /** USD per month, billed monthly. */
  price: number;
  /** USD per month, billed yearly (two months free). */
  annual: number;
  /** AI hook generations per month. */
  hooks: number;
  /** One line under the name. */
  line: string;
  /** "Everything in <previous plan>, plus:" (none for the first plan). */
  plus?: string;
  features: string[];
  popular?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 29,
    annual: 24,
    hooks: 20,
    line: "For your first videos",
    features: ["20 AI hooks a month", "Viral hook library", "Shot-by-shot demo scripts", "70 AI characters or your own photo", "Editor, trending songs, unlimited exports"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 59,
    annual: 49,
    hooks: 60,
    line: "For testing hooks every day",
    plus: "Starter",
    popular: true,
    features: ["60 AI hooks a month", "Reuse any hook on every demo", "Priority generation"],
  },
  {
    id: "studio",
    name: "Studio",
    price: 99,
    annual: 82,
    hooks: 150,
    line: "For many products and clients",
    plus: "Pro",
    features: ["150 AI hooks a month", "Several products and brands", "Priority support"],
  },
];

/** Business: done for you, priced per project. */
export const BUSINESS = {
  name: "Business",
  line: "Done for you",
  features: ["We find the hooks for your niche", "We write and storyboard every demo", "We make, edit and deliver the videos", "A dedicated producer and a weekly batch"],
  contact: "mailto:hello@mavya.app?subject=Mavya%20Business",
};

export const planById = (id: PlanId) => PLANS.find((p) => p.id === id) ?? PLANS[0];
export const priceOf = (p: Plan, cycle: BillingCycle) => (cycle === "annual" ? p.annual : p.price);
