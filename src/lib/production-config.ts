const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;
export function productionReady(): boolean {
 return process.env.NODE_ENV !== "production" || REQUIRED.every(key => Boolean(process.env[key]?.trim()));
}
export function assertProductionConfig() {
 if (!productionReady()) throw new Error("Production account storage is unavailable");
}

/** Billing-specific validation must not take unrelated app routes offline. */
export function stripeWebhookSecret(): string | null {
 const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
 return secret && /^whsec_\S+$/.test(secret) ? secret : null;
}
