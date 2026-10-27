import { notFound } from "next/navigation";

import { getPublicPage } from "@/server/public-queries";

/**
 * Answers a real 404 for an unknown or suspended pro. loading.tsx makes the page
 * stream, and a streamed response has already sent its 200 status when the page
 * calls notFound(); a layout renders before that boundary, so the check here still
 * sets the status code. The read is the `[slug]` layout's own, request-cached
 * `getPublicPage` (the page shares it too, so an espace render runs one professional
 * query); the `[slug]` layout lets a suspended pro through for the thank-you page,
 * the espace does not. Public data only (the pro's existence): nothing of a client
 * is read or cached in this file.
 */
export default async function EspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getPublicPage(slug);
  if (!page || page.suspended) notFound();
  return children;
}
