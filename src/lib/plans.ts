/**
 * Plans: the pricing page and the Billing page both read these (one place to change them).
 * Prices match mavya.app: $29 / $59 / $99 a month, or $290 / $590 / $990 a year (two months free).
 * Every plan makes the same videos; higher plans add our team's review and guidance. No free plan.
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

/** What every plan includes. */
export const EVERY_PLAN = [
  "20 AI video hooks a month",
  "Unlimited text on screen",
  "Unlimited shot-by-shot scripts for your app",
  "Unlimited AI characters, or your own face",
  "Hooks that already pulled millions of views",
  "Trending songs or the hook's original sound",
  "Built-in editor and unlimited exports",
];

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 29,
    yearly: 290,
    hooks: 20,
    line: "Everything you need to go viral",
    features: EVERY_PLAN,
  },
  {
    id: "pro",
    name: "Pro",
    price: 59,
    yearly: 590,
    hooks: 20,
    line: "Our team in your corner every week",
    plus: "Starter",
    popular: true,
    features: ["Weekly review of your videos by our team", "Written feedback: what to keep, what to change", "Hook picks for your app, every week", "Priority generation"],
  },
  {
    id: "studio",
    name: "Studio",
    price: 99,
    yearly: 990,
    hooks: 20,
    line: "Every video reviewed before you post",
    plus: "Pro",
    features: ["We review every video before you post", "Notes on the hook, the script and the edit", "1:1 guidance on what to make next", "Priority support"],
  },
];

/** Business: we run your short-form for you, paid on performance. */
export const BUSINESS = {
  name: "Business",
  line: "Done for you",
  price: "Pay for results",
  note: "Minimum applies. Miss the quota, you don't pay.",
  features: [
    "Send us your website. That's it.",
    "A dedicated marketing team runs your short-form",
    "We pick the hooks, make the demos, edit and post",
    "A monthly views quota, agreed up front",
    "Miss the quota, you don't pay for that month",
  ],
  contact: "mailto:hello@mavya.app?subject=Mavya%20Business",
};

export const planById = (id: PlanId) => PLANS.find((p) => p.id === id) ?? PLANS[0];
/** Price per month for the cycle (yearly shown as its monthly equivalent). */
export const priceOf = (p: Plan, cycle: BillingCycle) => (cycle === "annual" ? p.yearly / 12 : p.price);
export const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
