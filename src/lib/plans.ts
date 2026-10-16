/**
 * Plans: the landing page's pricing and the Billing page both read these (one place to change them).
 * AI hooks are the cost (each is one generation); editing and exporting are not.
 * Draft numbers until the founder sets them; checkout is not connected yet.
 */
export type PlanId = "free" | "starter" | "pro" | "studio";

export type Plan = {
  id: PlanId;
  name: string;
  /** USD per month. */
  price: number;
  /** AI hook generations per month. */
  hooks: number;
  /** Exports per month; null = unlimited. */
  exports: number | null;
  /** One line under the name. */
  line: string;
  features: string[];
  popular?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    hooks: 0,
    exports: 3,
    line: "Try the library and the editor",
    features: ["Viral hook library", "Full editor", "3 exports a month, with watermark"],
  },
  {
    id: "starter",
    name: "Starter",
    price: 29,
    hooks: 20,
    exports: null,
    line: "For one product",
    features: ["20 AI hooks a month", "Unlimited exports, no watermark", "70 AI characters or your own photo", "Songs and sounds"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 59,
    hooks: 60,
    exports: null,
    line: "For testing hooks every day",
    popular: true,
    features: ["60 AI hooks a month", "Everything in Starter"],
  },
  {
    id: "studio",
    name: "Studio",
    price: 99,
    hooks: 150,
    exports: null,
    line: "For many products and clients",
    features: ["150 AI hooks a month", "Everything in Pro", "Priority support"],
  },
];

export const planById = (id: PlanId) => PLANS.find((p) => p.id === id) ?? PLANS[0];
