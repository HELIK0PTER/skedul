const BASE = "http://next.invalid";

/**
 * The `?next=` target after sign-in, or null when it is not a plain path on
 * this site ("//host", "/\\host", absolute URLs and control characters are
 * all refused, so the redirect can never leave Skedul).
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
