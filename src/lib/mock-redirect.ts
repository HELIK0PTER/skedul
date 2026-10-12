/**
 * Where the mock checkout may send the browser once it has fulfilled an
 * order: the given success URL only when it stays on the app's own origin,
 * otherwise the app's home page (no open redirect).
 */
export function safeMockRedirect(value: string | null, appUrl: string): string {
  if (!value) return appUrl;
  try {
    const target = new URL(value, appUrl);
    return target.origin === new URL(appUrl).origin ? target.toString() : appUrl;
  } catch {
    return appUrl;
  }
}
