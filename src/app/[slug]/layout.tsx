import { notFound } from "next/navigation";

import { publicPageExists } from "@/server/public-queries";

/**
 * Answers a real 404 for an unknown slug. The loading.tsx of this segment makes its pages stream, and a streamed
 * response has already sent its 200 status when a page calls notFound(); a layout renders before that boundary, so the
 * check here still sets the status code (the same ruling as the espace layout, P3 1b743cc). A suspended pro still
 * exists here: the thank-you page must keep working for a client who paid just before the suspension, and every other
 * page applies the suspension itself. Public data only (the pro's existence): nothing of a client is read.
 */
export default async function SlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await publicPageExists(slug))) notFound();
  return children;
}
