import "server-only";

import { del, list, put } from "@vercel/blob";
import { and, count, eq, gte } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { supportAttachment, supportMessage, supportRequest, user } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { isSuspended } from "@/lib/suspension";
import {
  ATTACHMENT_EXTENSIONS,
  type AttachmentType,
  type SupportAuthorRole,
  type SupportMessageKind,
  type SupportResolution,
  type SupportStage,
} from "@/lib/support";

/**
 * Server-only building blocks shared by the user and admin support actions:
 * rate counts, thread writes, private image storage, read marks and the
 * admin e-mail fan-out. Neon HTTP has no interactive transactions, so callers
 * write in an order where a partial failure leaves a readable thread.
 */

const DAY_MS = 86_400_000;

/** The non-empty files of the "images" field (an empty file input sends one empty File). */
export function imageFiles(formData: FormData): File[] {
  return formData
    .getAll("images")
    .filter((value): value is File => value instanceof File && value.size > 0);
}

export async function countRecentRequests(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(supportRequest)
    .where(
      and(
        eq(supportRequest.userId, userId),
        gte(supportRequest.createdAt, new Date(Date.now() - DAY_MS)),
      ),
    );
  return row?.value ?? 0;
}

export async function countRecentMessages(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(supportMessage)
    .where(
      and(
        eq(supportMessage.authorId, userId),
        eq(supportMessage.authorRole, "user"),
        gte(supportMessage.createdAt, new Date(Date.now() - DAY_MS)),
      ),
    );
  return row?.value ?? 0;
}

export async function insertMessage(values: {
  requestId: string;
  authorId: string | null;
  authorRole: SupportAuthorRole;
  kind?: SupportMessageKind;
  body?: string;
  stage?: SupportStage | null;
  resolution?: SupportResolution | null;
}): Promise<string> {
  const [row] = await db
    .insert(supportMessage)
    .values({
      requestId: values.requestId,
      authorId: values.authorId,
      authorRole: values.authorRole,
      kind: values.kind ?? "message",
      body: values.body ?? "",
      stage: values.stage ?? null,
      resolution: values.resolution ?? null,
    })
    .returning({ id: supportMessage.id });
  return row.id;
}

/**
 * Uploads images as private blobs in the requester's folder (deleting the
 * account removes the folder), then records them. Best effort per file: the
 * message is already saved, so a failure is counted and logged, not thrown.
 */
export async function storeAttachments(
  requesterId: string,
  messageId: string,
  files: readonly File[],
): Promise<number> {
  if (!env.SUPPORT_BLOB_ENABLED) return files.length;
  let failed = 0;
  for (const file of files) {
    try {
      const ext = ATTACHMENT_EXTENSIONS[file.type as AttachmentType];
      const blob = await put(`support/${requesterId}/${nanoid()}.${ext}`, file, {
        access: "private",
        contentType: file.type,
        token: env.SUPPORT_BLOB_READ_WRITE_TOKEN,
      });
      await db.insert(supportAttachment).values({
        messageId,
        pathname: blob.pathname,
        contentType: file.type,
        size: file.size,
      });
    } catch (err) {
      failed += 1;
      console.error("[support] image upload failed", err);
    }
  }
  return failed;
}

export function uploadWarning(failed: number): string | undefined {
  if (failed === 0) return undefined;
  return failed === 1
    ? "1 image n’a pas pu être envoyée."
    : `${failed} images n’ont pas pu être envoyées.`;
}

/** Best effort, once the account is deleted: removes support/<userId>/. */
export async function deleteSupportFiles(userId: string): Promise<void> {
  if (!env.SUPPORT_BLOB_ENABLED) return;
  try {
    const prefix = `support/${userId}/`;
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, token: env.SUPPORT_BLOB_READ_WRITE_TOKEN });
      if (page.blobs.length) {
        await del(
          page.blobs.map((b) => b.url),
          { token: env.SUPPORT_BLOB_READ_WRITE_TOKEN },
        );
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error(`[support] could not delete the images of ${userId}`, err);
  }
}

export async function markReadByUser(userId: string, requestId: string): Promise<void> {
  await db
    .update(supportRequest)
    .set({ unreadByUser: false })
    .where(and(eq(supportRequest.id, requestId), eq(supportRequest.userId, userId)));
}

export async function markReadByAdmin(requestId: string): Promise<void> {
  await db
    .update(supportRequest)
    .set({ unreadByAdmin: false })
    .where(eq(supportRequest.id, requestId));
}

/** Sends `mail` to every active admin. Never throws. */
export async function emailAdmins(mail: { subject: string; html: string }): Promise<void> {
  try {
    const admins = await db
      .select({ email: user.email, banned: user.banned, banExpires: user.banExpires })
      .from(user)
      .where(eq(user.role, "admin"));
    await Promise.all(
      admins.filter((a) => !isSuspended(a)).map((a) => sendEmail({ to: a.email, ...mail })),
    );
  } catch (err) {
    console.error("[support] admin notification failed", err);
  }
}

export function requestUrl(id: string): string {
  return `${env.APP_URL}/aide/demandes/${id}`;
}

export function adminRequestUrl(id: string): string {
  return `${env.APP_URL}/admin/support/${id}`;
}
