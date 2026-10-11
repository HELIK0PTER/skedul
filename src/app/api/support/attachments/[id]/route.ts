import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";

import { getAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { supportAttachment, supportMessage, supportRequest } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";

/**
 * Streams a support screenshot (private Blob) to the request's owner or to an
 * admin. Anyone else gets the same 404 as a missing image.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const notFound = () => new Response("Not found", { status: 404 });

  const session = await getSession();
  if (!session || !env.SUPPORT_BLOB_ENABLED) return notFound();

  const [row] = await db
    .select({
      pathname: supportAttachment.pathname,
      contentType: supportAttachment.contentType,
      ownerId: supportRequest.userId,
    })
    .from(supportAttachment)
    .innerJoin(supportMessage, eq(supportMessage.id, supportAttachment.messageId))
    .innerJoin(supportRequest, eq(supportRequest.id, supportMessage.requestId))
    .where(eq(supportAttachment.id, id))
    .limit(1);
  if (!row) return notFound();
  if (row.ownerId !== session.user.id && !(await getAdminUser())) return notFound();

  const blob = await get(row.pathname, {
    access: "private",
    token: env.SUPPORT_BLOB_READ_WRITE_TOKEN,
  });
  if (!blob || blob.statusCode !== 200) return notFound();

  return new Response(blob.stream, {
    headers: {
      "Content-Type": row.contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
