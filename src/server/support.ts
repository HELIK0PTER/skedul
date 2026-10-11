"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { supportRequest } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import {
  MAX_BODY,
  MAX_MESSAGES_PER_DAY,
  MAX_REQUESTS_PER_DAY,
  MAX_SUBJECT,
  SUPPORT_TYPES,
  canUserReply,
  checkAttachments,
  stageAfterUserReply,
} from "@/lib/support";
import { supportNewRequestEmail, supportUserReplyEmail } from "@/lib/support-emails";
import {
  adminRequestUrl,
  countRecentMessages,
  countRecentRequests,
  emailAdmins,
  imageFiles,
  insertMessage,
  storeAttachments,
  uploadWarning,
} from "@/server/support-core";

export type SupportActionResult = { ok: true; warning?: string } | { ok: false; error: string };
export type CreateRequestResult =
  | { ok: true; id: string; warning?: string }
  | { ok: false; error: string };

type Requester = { id: string; name: string; email: string };

/** The signed-in user, unless an admin is impersonating them (never write in someone's name). */
async function requester(): Promise<Requester | { error: string }> {
  const session = await getSession();
  if (!session) return { error: "Connectez-vous pour continuer." };
  if (session.session.impersonatedBy) {
    return { error: "Action désactivée pendant une connexion en tant que ce compte." };
  }
  return { id: session.user.id, name: session.user.name, email: session.user.email };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Données invalides.";

const createSchema = z.object({
  type: z.enum(SUPPORT_TYPES, { error: "Choisissez le type de demande." }),
  subject: z
    .string()
    .transform(oneLine)
    .pipe(
      z
        .string()
        .min(3, "Le sujet est trop court.")
        .max(MAX_SUBJECT, `Le sujet ne doit pas dépasser ${MAX_SUBJECT} caractères.`),
    ),
  body: z
    .string()
    .trim()
    .min(10, "Décrivez votre demande en quelques mots de plus.")
    .max(MAX_BODY, "Votre message est trop long."),
});

const replySchema = z.object({
  requestId: z.string().min(1, "Demande introuvable."),
  body: z.string().trim().max(MAX_BODY, "Votre message est trop long."),
});

export async function createSupportRequest(formData: FormData): Promise<CreateRequestResult> {
  const me = await requester();
  if ("error" in me) return { ok: false, error: me.error };

  const parsed = createSchema.safeParse({
    type: formData.get("type"),
    subject: String(formData.get("subject") ?? ""),
    body: String(formData.get("body") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const files = imageFiles(formData);
  const check = checkAttachments(files);
  if (!check.ok) return check;
  if (files.length && !env.SUPPORT_BLOB_ENABLED) {
    return { ok: false, error: "L’envoi d’images n’est pas disponible." };
  }

  try {
    if ((await countRecentRequests(me.id)) >= MAX_REQUESTS_PER_DAY) {
      return {
        ok: false,
        error: `Vous avez atteint la limite de ${MAX_REQUESTS_PER_DAY} demandes par jour. Réessayez demain.`,
      };
    }
    const { type, subject, body } = parsed.data;
    // Request, then its first message, then the images: each step keeps a readable thread.
    const [created] = await db
      .insert(supportRequest)
      .values({ userId: me.id, type, subject })
      .returning({ id: supportRequest.id, number: supportRequest.number });
    const messageId = await insertMessage({
      requestId: created.id,
      authorId: me.id,
      authorRole: "user",
      body,
    });
    const failed = await storeAttachments(me.id, messageId, files);
    await emailAdmins(
      supportNewRequestEmail({
        number: created.number,
        subject,
        type,
        authorName: me.name,
        authorEmail: me.email,
        body,
        url: adminRequestUrl(created.id),
      }),
    );
    revalidatePath("/aide/demandes");
    revalidatePath("/admin/support");
    return { ok: true, id: created.id, warning: uploadWarning(failed) };
  } catch (err) {
    console.error("[support] request creation failed", err);
    return { ok: false, error: "Impossible d’envoyer la demande. Réessayez." };
  }
}

export async function replyToSupportRequest(formData: FormData): Promise<SupportActionResult> {
  const me = await requester();
  if ("error" in me) return { ok: false, error: me.error };

  const parsed = replySchema.safeParse({
    requestId: String(formData.get("requestId") ?? ""),
    body: String(formData.get("body") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const files = imageFiles(formData);
  if (!parsed.data.body && files.length === 0) {
    return { ok: false, error: "Écrivez un message ou joignez une image." };
  }
  const check = checkAttachments(files);
  if (!check.ok) return check;
  if (files.length && !env.SUPPORT_BLOB_ENABLED) {
    return { ok: false, error: "L’envoi d’images n’est pas disponible." };
  }

  try {
    const [request] = await db
      .select()
      .from(supportRequest)
      .where(and(eq(supportRequest.id, parsed.data.requestId), eq(supportRequest.userId, me.id)))
      .limit(1);
    if (!request) return { ok: false, error: "Demande introuvable." };
    if (!canUserReply(request)) return { ok: false, error: "Cette demande est fermée." };
    if ((await countRecentMessages(me.id)) >= MAX_MESSAGES_PER_DAY) {
      return { ok: false, error: "Vous avez envoyé beaucoup de messages aujourd’hui. Réessayez demain." };
    }

    const messageId = await insertMessage({
      requestId: request.id,
      authorId: me.id,
      authorRole: "user",
      body: parsed.data.body,
    });
    const failed = await storeAttachments(me.id, messageId, files);
    const stage = stageAfterUserReply(request);
    await db
      .update(supportRequest)
      .set({ stage, unreadByAdmin: true, lastActivityAt: new Date() })
      .where(eq(supportRequest.id, request.id));
    if (stage !== request.stage) {
      // a reply on a resolved request reopens it: show it in the thread
      await insertMessage({
        requestId: request.id,
        authorId: null,
        authorRole: "system",
        kind: "stage_change",
        stage,
      });
    }
    await emailAdmins(
      supportUserReplyEmail({
        number: request.number,
        subject: request.subject,
        authorName: me.name,
        body: parsed.data.body || "(image jointe)",
        url: adminRequestUrl(request.id),
      }),
    );
    revalidatePath(`/aide/demandes/${request.id}`);
    revalidatePath("/aide/demandes");
    revalidatePath("/admin/support");
    return { ok: true, warning: uploadWarning(failed) };
  } catch (err) {
    console.error("[support] reply failed", err);
    return { ok: false, error: "Impossible d’envoyer le message. Réessayez." };
  }
}
