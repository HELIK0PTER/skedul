"use server";

import { revalidatePath } from "next/cache";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getAdminUser, type AdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { helpArticle, helpCategory, supportRequest, user } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import {
  HELP_ICONS,
  MAX_BODY,
  SUPPORT_RESOLUTIONS,
  SUPPORT_STAGES,
  canAcceptForDevelopment,
  canSetStage,
  checkAttachments,
  isValidEta,
  moveInList,
  stageAfterAdminReply,
  type SupportResolution,
  type SupportStage,
} from "@/lib/support";
import {
  supportAdminReplyEmail,
  supportResolutionEmail,
  supportStageEmail,
} from "@/lib/support-emails";
import { slugify } from "@/lib/utils";
import {
  imageFiles,
  insertMessage,
  requestUrl,
  storeAttachments,
  uploadWarning,
} from "@/server/support-core";

export type AdminSupportResult = { ok: true; warning?: string } | { ok: false; error: string };

type Loaded = {
  admin: AdminUser;
  request: typeof supportRequest.$inferSelect;
  requester: { name: string; email: string };
};

/** The caller must be an active admin (re-read from the DB) and the request must exist. */
async function load(id: string): Promise<Loaded | { error: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Accès refusé." };
  const [row] = await db
    .select({ request: supportRequest, name: user.name, email: user.email })
    .from(supportRequest)
    .innerJoin(user, eq(user.id, supportRequest.userId))
    .where(eq(supportRequest.id, id))
    .limit(1);
  if (!row) return { error: "Demande introuvable." };
  return { admin, request: row.request, requester: { name: row.name, email: row.email } };
}

function refresh(id: string) {
  revalidatePath("/admin/support");
  revalidatePath("/admin/support/developpements");
  revalidatePath(`/admin/support/${id}`);
  revalidatePath("/aide/demandes");
  revalidatePath(`/aide/demandes/${id}`);
}

function failure(err: unknown): AdminSupportResult {
  console.error("[support-admin] action failed", err);
  return { ok: false, error: "Action impossible. Réessayez." };
}

/* ── Requests ── */

export async function adminReply(formData: FormData): Promise<AdminSupportResult> {
  const id = String(formData.get("requestId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const files = imageFiles(formData);
  if (!body && files.length === 0) {
    return { ok: false, error: "Écrivez un message ou joignez une image." };
  }
  if (body.length > MAX_BODY) return { ok: false, error: "Message trop long." };
  const check = checkAttachments(files);
  if (!check.ok) return check;
  if (files.length && !env.SUPPORT_BLOB_ENABLED) {
    return { ok: false, error: "L’envoi d’images n’est pas disponible." };
  }

  const loaded = await load(id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { admin, request, requester } = loaded;
  try {
    const stage = stageAfterAdminReply(request);
    if (stage !== request.stage) {
      // guarded on track, stage and open state: a concurrent step change or
      // "accept for development" wins, and nothing is written
      const moved = await db
        .update(supportRequest)
        .set({ stage })
        .where(
          and(
            eq(supportRequest.id, id),
            eq(supportRequest.track, request.track),
            eq(supportRequest.stage, request.stage),
            isNull(supportRequest.resolution),
          ),
        )
        .returning({ id: supportRequest.id });
      if (moved.length === 0) {
        return { ok: false, error: "La demande a changé entre-temps. Rechargez la page." };
      }
      // the first answer means the request is being handled
      await insertMessage({ requestId: id, authorId: admin.id, authorRole: "admin", kind: "stage_change", stage });
    }
    const messageId = await insertMessage({ requestId: id, authorId: admin.id, authorRole: "admin", body });
    const failed = await storeAttachments(request.userId, messageId, files);
    // the stage is never written here: it is set above, guarded, or left alone
    await db
      .update(supportRequest)
      .set({ unreadByUser: true, lastActivityAt: new Date() })
      .where(eq(supportRequest.id, id));
    await sendEmail({
      to: requester.email,
      ...supportAdminReplyEmail({
        name: requester.name,
        number: request.number,
        subject: request.subject,
        body: body || "(image jointe)",
        url: requestUrl(id),
      }),
    });
    refresh(id);
    return { ok: true, warning: uploadWarning(failed) };
  } catch (err) {
    return failure(err);
  }
}

export async function setSupportStage(input: {
  id: string;
  stage: SupportStage;
}): Promise<AdminSupportResult> {
  if (!(SUPPORT_STAGES as readonly string[]).includes(input.stage)) {
    return { ok: false, error: "Étape inconnue." };
  }
  const loaded = await load(input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { admin, request, requester } = loaded;
  if (request.resolution) return { ok: false, error: "Rouvrez d’abord la demande." };
  if (!canSetStage(request.track, input.stage)) {
    return { ok: false, error: "Cette étape n’existe pas pour ce suivi." };
  }
  if (input.stage === request.stage) return { ok: true };
  try {
    // guarded on the track: a concurrent "accept for development" wins
    const updated = await db
      .update(supportRequest)
      .set({ stage: input.stage, unreadByUser: true, lastActivityAt: new Date() })
      .where(and(eq(supportRequest.id, request.id), eq(supportRequest.track, request.track)))
      .returning({ id: supportRequest.id });
    if (updated.length === 0) {
      return { ok: false, error: "La demande a changé entre-temps. Rechargez la page." };
    }
    await insertMessage({
      requestId: request.id,
      authorId: admin.id,
      authorRole: "admin",
      kind: "stage_change",
      stage: input.stage,
    });
    await sendEmail({
      to: requester.email,
      ...supportStageEmail({
        name: requester.name,
        number: request.number,
        subject: request.subject,
        track: request.track,
        stage: input.stage,
        eta: request.eta,
        url: requestUrl(request.id),
      }),
    });
    refresh(request.id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function acceptForDevelopment(input: {
  id: string;
  eta: string | null;
}): Promise<AdminSupportResult> {
  const eta = input.eta || null;
  if (eta && !isValidEta(eta)) return { ok: false, error: "Date de livraison invalide." };
  const loaded = await load(input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { admin, request, requester } = loaded;
  if (!canAcceptForDevelopment(request)) {
    return { ok: false, error: "Cette demande ne peut plus passer en développement." };
  }
  try {
    const updated = await db
      .update(supportRequest)
      .set({
        track: "development",
        stage: "accepted",
        eta,
        unreadByUser: true,
        lastActivityAt: new Date(),
      })
      .where(and(eq(supportRequest.id, request.id), eq(supportRequest.track, "support")))
      .returning({ id: supportRequest.id });
    if (updated.length === 0) {
      return { ok: false, error: "La demande a changé entre-temps. Rechargez la page." };
    }
    await insertMessage({
      requestId: request.id,
      authorId: admin.id,
      authorRole: "admin",
      kind: "stage_change",
      stage: "accepted",
    });
    await sendEmail({
      to: requester.email,
      ...supportStageEmail({
        name: requester.name,
        number: request.number,
        subject: request.subject,
        track: "development",
        stage: "accepted",
        eta,
        url: requestUrl(request.id),
      }),
    });
    refresh(request.id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function setSupportEta(input: {
  id: string;
  eta: string | null;
}): Promise<AdminSupportResult> {
  const eta = input.eta || null;
  if (eta && !isValidEta(eta)) return { ok: false, error: "Date de livraison invalide." };
  const loaded = await load(input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (loaded.request.track !== "development") {
    return { ok: false, error: "La date de livraison concerne les développements." };
  }
  try {
    await db.update(supportRequest).set({ eta }).where(eq(supportRequest.id, input.id));
    refresh(input.id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function resolveSupportRequest(input: {
  id: string;
  resolution: SupportResolution;
  reason: string;
}): Promise<AdminSupportResult> {
  if (!(SUPPORT_RESOLUTIONS as readonly string[]).includes(input.resolution)) {
    return { ok: false, error: "Action inconnue." };
  }
  const reason = input.reason.trim().slice(0, MAX_BODY);
  if (input.resolution === "declined" && reason.length < 3) {
    return { ok: false, error: "Expliquez en quelques mots pourquoi la demande n’est pas retenue." };
  }
  const loaded = await load(input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { admin, request, requester } = loaded;
  if (request.resolution) return { ok: false, error: "Cette demande est déjà terminée." };
  try {
    await db
      .update(supportRequest)
      .set({ resolution: input.resolution, unreadByUser: true, lastActivityAt: new Date() })
      .where(eq(supportRequest.id, request.id));
    await insertMessage({
      requestId: request.id,
      authorId: admin.id,
      authorRole: "admin",
      kind: "resolution",
      resolution: input.resolution,
      body: reason,
    });
    await sendEmail({
      to: requester.email,
      ...supportResolutionEmail({
        name: requester.name,
        number: request.number,
        subject: request.subject,
        resolution: input.resolution,
        reason,
        url: requestUrl(request.id),
      }),
    });
    refresh(request.id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function reopenSupportRequest(input: { id: string }): Promise<AdminSupportResult> {
  const loaded = await load(input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { admin, request, requester } = loaded;
  if (!request.resolution) return { ok: true };
  try {
    await db
      .update(supportRequest)
      .set({ resolution: null, unreadByUser: true, lastActivityAt: new Date() })
      .where(eq(supportRequest.id, request.id));
    await insertMessage({
      requestId: request.id,
      authorId: admin.id,
      authorRole: "admin",
      kind: "resolution",
      resolution: null,
    });
    await sendEmail({
      to: requester.email,
      ...supportResolutionEmail({
        name: requester.name,
        number: request.number,
        subject: request.subject,
        resolution: null,
        reason: "",
        url: requestUrl(request.id),
      }),
    });
    refresh(request.id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/* ── FAQ ── */

function refreshFaq() {
  revalidatePath("/aide");
  revalidatePath("/admin/support/faq");
}

const categorySchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(2, "Titre trop court.").max(80, "Titre trop long."),
  icon: z.enum(HELP_ICONS, { error: "Icône inconnue." }),
});

const articleSchema = z.object({
  id: z.string().min(1).optional(),
  categoryId: z.string().min(1, "Choisissez une rubrique."),
  question: z.string().trim().min(5, "Question trop courte.").max(200, "Question trop longue."),
  answer: z.string().trim().min(10, "Réponse trop courte.").max(MAX_BODY, "Réponse trop longue."),
  published: z.boolean(),
});

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Données invalides.";

async function uniqueCategorySlug(title: string): Promise<string> {
  const root = slugify(title) || "rubrique";
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const [taken] = await db
      .select({ id: helpCategory.id })
      .from(helpCategory)
      .where(eq(helpCategory.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
}

export async function saveHelpCategory(input: {
  id?: string;
  title: string;
  icon: string;
}): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, title, icon } = parsed.data;
  try {
    if (id) {
      // the slug (anchor) stays stable when the title changes
      await db.update(helpCategory).set({ title, icon }).where(eq(helpCategory.id, id));
    } else {
      const [{ value: position }] = await db.select({ value: count() }).from(helpCategory);
      await db
        .insert(helpCategory)
        .values({ title, icon, slug: await uniqueCategorySlug(title), position });
    }
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteHelpCategory(input: { id: string }): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  try {
    const [{ value }] = await db
      .select({ value: count() })
      .from(helpArticle)
      .where(eq(helpArticle.categoryId, input.id));
    if (value > 0) return { ok: false, error: "Déplacez ou supprimez d’abord ses articles." };
    await db.delete(helpCategory).where(eq(helpCategory.id, input.id));
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function moveHelpCategory(input: {
  id: string;
  direction: "up" | "down";
}): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  try {
    const rows = await db
      .select({ id: helpCategory.id })
      .from(helpCategory)
      .orderBy(asc(helpCategory.position), asc(helpCategory.createdAt));
    const order = moveInList(rows.map((r) => r.id), input.id, input.direction);
    if (!order) return { ok: true };
    // renumber everything: also repairs duplicate positions
    await Promise.all(
      order.map((id, position) =>
        db.update(helpCategory).set({ position }).where(eq(helpCategory.id, id)),
      ),
    );
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function saveHelpArticle(input: {
  id?: string;
  categoryId: string;
  question: string;
  answer: string;
  published: boolean;
}): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  const parsed = articleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, categoryId, question, answer, published } = parsed.data;
  try {
    const [category] = await db
      .select({ id: helpCategory.id })
      .from(helpCategory)
      .where(eq(helpCategory.id, categoryId))
      .limit(1);
    if (!category) return { ok: false, error: "Rubrique introuvable." };
    const countIn = async () => {
      const [{ value }] = await db
        .select({ value: count() })
        .from(helpArticle)
        .where(eq(helpArticle.categoryId, categoryId));
      return value;
    };
    if (id) {
      const [current] = await db
        .select({ categoryId: helpArticle.categoryId })
        .from(helpArticle)
        .where(eq(helpArticle.id, id))
        .limit(1);
      if (!current) return { ok: false, error: "Article introuvable." };
      // moved to another category: append it there
      const position = current.categoryId === categoryId ? undefined : await countIn();
      await db
        .update(helpArticle)
        .set({ categoryId, question, answer, published, ...(position === undefined ? {} : { position }) })
        .where(eq(helpArticle.id, id));
    } else {
      await db
        .insert(helpArticle)
        .values({ categoryId, question, answer, published, position: await countIn() });
    }
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteHelpArticle(input: { id: string }): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  try {
    await db.delete(helpArticle).where(eq(helpArticle.id, input.id));
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function setHelpArticlePublished(input: {
  id: string;
  published: boolean;
}): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  try {
    await db
      .update(helpArticle)
      .set({ published: input.published })
      .where(eq(helpArticle.id, input.id));
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function moveHelpArticle(input: {
  id: string;
  direction: "up" | "down";
}): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  try {
    const [article] = await db
      .select({ categoryId: helpArticle.categoryId })
      .from(helpArticle)
      .where(eq(helpArticle.id, input.id))
      .limit(1);
    if (!article) return { ok: false, error: "Article introuvable." };
    const rows = await db
      .select({ id: helpArticle.id })
      .from(helpArticle)
      .where(eq(helpArticle.categoryId, article.categoryId))
      .orderBy(asc(helpArticle.position), asc(helpArticle.createdAt));
    const order = moveInList(rows.map((r) => r.id), input.id, input.direction);
    if (!order) return { ok: true };
    await Promise.all(
      order.map((id, position) =>
        db.update(helpArticle).set({ position }).where(eq(helpArticle.id, id)),
      ),
    );
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}
