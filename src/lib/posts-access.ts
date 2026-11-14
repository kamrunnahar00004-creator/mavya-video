// Who may use Scheduled posts (founder 2026-11-15: owner-only). No imports, so the proxy, the API and the cron share it.

/** The account ids in SCHEDULED_POSTS_USERS (comma-separated). Empty: off for everyone. */
export function schedulerUsers(env: Record<string, string | undefined> = process.env): string[] {
  return (env.SCHEDULED_POSTS_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Whether this account may use it. Every post goes to the founder's Instagram and Facebook Page (META_PAGE_TOKEN), so
 * opening it to everyone needs each user's own Meta connection and Meta's App Review first, never just a longer list.
 */
export function schedulerAllowed(who: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(who) && schedulerUsers(env).includes(who as string);
}

/** /posts and anything under it. */
export const isPostsPage = (pathname: string) => pathname === "/posts" || pathname.startsWith("/posts/");
