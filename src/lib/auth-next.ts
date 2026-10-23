/** Shared client/callback boundary. Reject control characters before URL normalization. */
export function safeNext(raw: string | null, origin = "https://mavya.invalid"): string {
 if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return "/studio";
 try {
  const parsed = new URL(raw, origin);
  return parsed.origin === origin ? `${parsed.pathname}${parsed.search}` : "/studio";
 } catch { return "/studio"; }
}
