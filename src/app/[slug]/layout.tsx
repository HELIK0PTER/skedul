import { notFound } from "next/navigation";

import { SLUG_PARAM_RE } from "@/lib/public/context";
import { getPublicPage } from "@/server/public-queries";

/**
 * Answers a real 404 for an unknown slug. The loading.tsx of this segment makes its pages stream, and a streamed
 * response has already sent its 200 status when a page calls notFound(); a layout renders before that boundary, so the
 * check here still sets the status code (the same ruling as the espace layout, P3 1b743cc). A segment that cannot be a
 * pro address (a bot probing /.env or /wp-login.php) is a 404 before any read (G4b). The read is the request-cached one
 * of the page (getPublicPage), so a `/[slug]` render runs one professional query. A suspended pro still exists here:
 * the thank-you page must keep working for a client who paid just before the suspension, and every other page applies
 * the suspension itself. Public data only (the pro's existence): nothing of a client is read.
 */
export default async function SlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!SLUG_PARAM_RE.test(slug)) notFound();
  if (!(await getPublicPage(slug))) notFound();
  return children;
}
