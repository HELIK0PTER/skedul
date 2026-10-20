import { notFound } from "next/navigation";

import { getSpaceProfile } from "@/server/client-queries";

/**
 * Answers a real 404 for an unknown or suspended pro. loading.tsx makes the page
 * stream, and a streamed response has already sent its 200 status when the page
 * calls notFound(); a layout renders before that boundary, so the check here still
 * sets the status code. Public data only (the pro's existence): nothing of a
 * client is read or cached in this file.
 */
export default async function EspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await getSpaceProfile(slug))) notFound();
  return children;
}
