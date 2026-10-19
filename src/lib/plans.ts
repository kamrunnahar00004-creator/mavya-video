/**
 * Plans: the pricing page and the Billing page both read these (one place to change them).
 * Prices match mavya.app: $29 / $59 / $99 a month, or $290 / $590 / $990 a year (two months free).
 * Every plan makes the same videos; Pro adds a weekly review, Studio a social media consultant. No free plan.
 * Checkout is not connected yet.
 */
export type PlanId = "starter" | "pro" | "studio";
export type BillingCycle = "monthly" | "annual";

export type Plan = {
  id: PlanId;
  name: string;
  /** USD per month, billed monthly. */
  price: number;
  /** USD per year, billed yearly. */
  yearly: number;
  /** AI video hooks per month. */
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
    yearly: 290,
    hooks: 20,
    line: "Everything you need to go viral",
    features: ["20 AI video hooks a month", "Unlimited text on screen", "Unlimited shot-by-shot scripts", "Unlimited AI characters", "Unlimited edits", "Unlimited exports"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 59,
    yearly: 590,
    hooks: 60,
    line: "Our team in your corner every week",
    plus: "Starter",
    popular: true,
    features: ["60 AI video hooks a month", "Weekly review and feedback", "Priority generation"],
  },
  {
    id: "studio",
    name: "Studio",
    price: 99,
    yearly: 990,
    hooks: 150,
    line: "One on one with a short-form expert",
    plus: "Pro",
    features: ["150 AI video hooks a month", "Your own social media consultant", "1:1 guidance and priority support"],
  },
];

/** Business: we run your short-form for you, paid on performance. */
export const BUSINESS = {
  name: "Business",
  line: "Done for you",
  price: "Pay for results",
  note: "Minimum applies. Miss the quota, you don't pay.",
  features: ["Send us your website. That's it.", "A dedicated team runs your short-form", "A views quota, agreed up front", "Miss it, you don't pay"],
};

export const planById = (id: PlanId) => PLANS.find((p) => p.id === id) ?? PLANS[0];
/** Price per month for the cycle (yearly shown as its monthly equivalent). */
export const priceOf = (p: Plan, cycle: BillingCycle) => (cycle === "annual" ? p.yearly / 12 : p.price);
export const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
