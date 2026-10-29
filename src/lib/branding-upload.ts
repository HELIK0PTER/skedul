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

/** The image types /api/upload accepts, and the file extension each one is stored with. */
export const BRANDING_TYPES = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type BrandingExt = (typeof BRANDING_TYPES)[keyof typeof BRANDING_TYPES];

/** The Blob pathname of a pro's branding image: one folder per pro, the kind in the file name (P6 A5). */
export function brandingBlobPath(professionalId: string, kind: BrandingKind, id: string, ext: BrandingExt): string {
  return `branding/${professionalId}/${kind}-${id}.${ext}`;
}

/**
 * The host of the project's public Blob store, read from its read-write token (`vercel_blob_rw_<storeId>_<secret>`, the
 * split @vercel/blob makes itself), or null without a usable token. The secret part never leaves this function.
 */
export function publicBlobHost(token: string | null | undefined): string | null {
  if (!token?.startsWith("vercel_blob_rw_")) return null;
  const storeId = token.split("_")[3];
  if (!storeId || !/^[A-Za-z0-9]+$/.test(storeId) || token.split("_").length < 5) return null;
  return `${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

const UPLOAD_FILE = /^[A-Za-z0-9_-]+\.(?:jpeg|png|webp)$/;

/**
 * True when `url` is a branding image /api/upload stored for this pro and this kind (P6 A5): https, the project's own
 * public store (`blobHost`, null when none is configured), the pro's folder, a jpeg, png or webp file, and written in
 * its canonical form (no port, credentials, query, fragment, dot segment or escape), so what the public page renders is
 * exactly a file the pro uploaded.
 */
export function isOwnBrandingUpload(
  url: string,
  rules: { blobHost: string | null; professionalId: string; kind: BrandingKind },
): boolean {
  if (!rules.blobHost) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.href !== url || parsed.protocol !== "https:" || parsed.host !== rules.blobHost) return false;
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return false;
  const folder = `/branding/${rules.professionalId}/${rules.kind}-`;
  return parsed.pathname.startsWith(folder) && UPLOAD_FILE.test(parsed.pathname.slice(folder.length));
}

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
