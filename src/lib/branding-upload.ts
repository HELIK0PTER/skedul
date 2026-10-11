/**
 * Limits for the pros' branding images, shared by `/api/upload` and the
 * branding form. Vercel rejects any request body over 4.5 MB before the route
 * runs, so every limit stays below it (the form also shrinks large images in
 * the browser first, see `src/lib/shrink-image.ts`).
 */
export const BRANDING_MAX_BYTES = {
  banner: 4_000_000,
  avatar: 2_000_000,
} as const;

export type BrandingKind = keyof typeof BRANDING_MAX_BYTES;

/**
 * French message for a failed upload. The route answers `{ error }`, but a
 * body over Vercel's cap gets a 413 from the platform with no JSON at all.
 */
export function uploadErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  if (status === 413) return "Image trop lourde.";
  return "L’envoi de l’image a échoué. Réessayez.";
}
