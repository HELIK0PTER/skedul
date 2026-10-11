const BASE = "http://next.invalid";

/**
 * The `?next=` target after sign-in, or null when it is not a plain path on
 * this site ("//host", "/\\host", absolute URLs and control characters are
 * all refused, so the redirect can never leave Skedul). The result is the
 * URL-normalized path, which is re-checked: dot segments can collapse
 * "/.//host" into "//host", so a protocol-relative result is refused too.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  // The URL parser reads "\" as "/", so any backslash can hide a "//".
  if (value.includes("\\")) return null;
  if (value.startsWith("//")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return null;
    const path = `${url.pathname}${url.search}${url.hash}`;
    // Normalization (dot segments) must not yield "//host" or "/\host".
    if (!path.startsWith("/") || path[1] === "/" || path[1] === "\\") return null;
    return path;
  } catch {
    return null;
  }
}
