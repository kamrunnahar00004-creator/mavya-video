/**
 * Maintenance mode for the first production deploy: the marketing pages (landing, pricing, terms, privacy) are live
 * with a banner; the app and its API are closed until accounts, storage and Stripe are connected. Set
 * NEXT_PUBLIC_MAINTENANCE=1 in the Vercel project (it is read at build time, so redeploy after changing it).
 */
export const MAINTENANCE = process.env.NEXT_PUBLIC_MAINTENANCE === "1";
