import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  helpArticle,
  helpCategory,
  professional,
  supportAttachment,
  supportMessage,
  supportRequest,
  user,
} from "@/lib/db/schema";
import {
  INBOX_PAGE_SIZE,
  isHelpIcon,
  type HelpIcon,
  type InboxFilter,
  type SupportAuthorRole,
  type SupportMessageKind,
  type SupportResolution,
  type SupportStage,
  type SupportType,
} from "@/lib/support";

export type SupportRequestRow = typeof supportRequest.$inferSelect;

export type ThreadMessage = {
  id: string;
  authorRole: SupportAuthorRole;
  authorName: string | null;
  kind: SupportMessageKind;
  body: string;
  stage: SupportStage | null;
  resolution: SupportResolution | null;
  createdAt: Date;
  attachments: { id: string; contentType: string }[];
};

export type FaqArticle = {
  id: string;
  question: string;
  answer: string;
  position: number;
  published: boolean;
};

export type FaqCategory = {
  id: string;
  title: string;
  slug: string;
  icon: HelpIcon;
  position: number;
  articles: FaqArticle[];
};

export type InboxRow = SupportRequestRow & { authorName: string; authorEmail: string };

export type AdminRequestDetail = {
  request: SupportRequestRow;
  author: {
    id: string;
    name: string;
    email: string;
    proSlug: string | null;
    businessName: string | null;
  };
  thread: ThreadMessage[];
};

/* ── FAQ ── */

async function loadFaq(publishedOnly: boolean): Promise<FaqCategory[]> {
  const [categories, articles] = await Promise.all([
    db
      .select()
      .from(helpCategory)
      .orderBy(asc(helpCategory.position), asc(helpCategory.createdAt)),
    db
      .select()
      .from(helpArticle)
      .where(publishedOnly ? eq(helpArticle.published, true) : undefined)
      .orderBy(asc(helpArticle.position), asc(helpArticle.createdAt)),
  ]);
  return categories.map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    icon: isHelpIcon(c.icon) ? c.icon : "help",
    position: c.position,
    articles: articles
      .filter((a) => a.categoryId === c.id)
      .map((a) => ({
        id: a.id,
        question: a.question,
        answer: a.answer,
        position: a.position,
        published: a.published,
      })),
  }));
}

/** Public FAQ: published articles only; empty categories are left out. */
export async function getPublishedFaq(): Promise<FaqCategory[]> {
  return (await loadFaq(true)).filter((c) => c.articles.length > 0);
}

export function getFaqForAdmin(): Promise<FaqCategory[]> {
  return loadFaq(false);
}

/* ── Requester side ── */

export async function getMyRequests(userId: string): Promise<SupportRequestRow[]> {
  return db
    .select()
    .from(supportRequest)
    .where(eq(supportRequest.userId, userId))
    .orderBy(desc(supportRequest.lastActivityAt), desc(supportRequest.id));
}

/** The request with its thread, or null when it does not exist or is someone else's. */
export async function getMyRequest(
  userId: string,
  id: string,
): Promise<{ request: SupportRequestRow; thread: ThreadMessage[] } | null> {
  const [request] = await db
    .select()
    .from(supportRequest)
    .where(and(eq(supportRequest.id, id), eq(supportRequest.userId, userId)))
    .limit(1);
  if (!request) return null;
  return { request, thread: await getThread(id) };
}

export async function hasUnreadSupport(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: supportRequest.id })
    .from(supportRequest)
    .where(and(eq(supportRequest.userId, userId), eq(supportRequest.unreadByUser, true)))
    .limit(1);
  return Boolean(row);
}

async function getThread(requestId: string): Promise<ThreadMessage[]> {
  const messages = await db
    .select({
      id: supportMessage.id,
      authorRole: supportMessage.authorRole,
      authorName: user.name,
      kind: supportMessage.kind,
      body: supportMessage.body,
      stage: supportMessage.stage,
      resolution: supportMessage.resolution,
      createdAt: supportMessage.createdAt,
    })
    .from(supportMessage)
    .leftJoin(user, eq(user.id, supportMessage.authorId))
    .where(eq(supportMessage.requestId, requestId))
    .orderBy(asc(supportMessage.createdAt), asc(supportMessage.id));
  if (messages.length === 0) return [];
  const attachments = await db
    .select({
      id: supportAttachment.id,
      messageId: supportAttachment.messageId,
      contentType: supportAttachment.contentType,
    })
    .from(supportAttachment)
    .where(inArray(supportAttachment.messageId, messages.map((m) => m.id)))
    .orderBy(asc(supportAttachment.createdAt));
  return messages.map((m) => ({
    ...m,
    attachments: attachments
      .filter((a) => a.messageId === m.id)
      .map(({ id, contentType }) => ({ id, contentType })),
  }));
}

/* ── Admin side ── */

const FINAL_STAGES: SupportStage[] = ["resolved", "delivered"];

function inboxCondition(filter: InboxFilter): SQL | undefined {
  switch (filter) {
    case "todo":
      return or(
        eq(supportRequest.unreadByAdmin, true),
        and(eq(supportRequest.stage, "received"), isNull(supportRequest.resolution)),
      );
    case "open":
      return and(isNull(supportRequest.resolution), notInArray(supportRequest.stage, FINAL_STAGES));
    case "done":
      return or(isNotNull(supportRequest.resolution), inArray(supportRequest.stage, FINAL_STAGES));
    case "all":
      return undefined;
  }
}

export async function getSupportInbox(opts: {
  filter: InboxFilter;
  type: SupportType | null;
  page: number;
}): Promise<{ rows: InboxRow[]; total: number }> {
  const where = and(
    inboxCondition(opts.filter),
    opts.type ? eq(supportRequest.type, opts.type) : undefined,
  );
  const [rows, totals] = await Promise.all([
    db
      .select({ request: supportRequest, authorName: user.name, authorEmail: user.email })
      .from(supportRequest)
      .innerJoin(user, eq(user.id, supportRequest.userId))
      .where(where)
      // unread first; id breaks ties so offset paging never repeats a row
      .orderBy(
        desc(supportRequest.unreadByAdmin),
        desc(supportRequest.lastActivityAt),
        desc(supportRequest.id),
      )
      .limit(INBOX_PAGE_SIZE)
      .offset((opts.page - 1) * INBOX_PAGE_SIZE),
    db.select({ value: count() }).from(supportRequest).where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r.request, authorName: r.authorName, authorEmail: r.authorEmail })),
    total: totals[0]?.value ?? 0,
  };
}

/** Badge of the admin sidebar: what the "À traiter" filter lists. */
export async function countSupportToHandle(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(supportRequest)
    .where(inboxCondition("todo"));
  return row?.value ?? 0;
}

/** Live development requests; delivered ones stay on the board for 30 days. */
export async function getDevBoard(): Promise<InboxRow[]> {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db
    .select({ request: supportRequest, authorName: user.name, authorEmail: user.email })
    .from(supportRequest)
    .innerJoin(user, eq(user.id, supportRequest.userId))
    .where(
      and(
        eq(supportRequest.track, "development"),
        isNull(supportRequest.resolution),
        or(ne(supportRequest.stage, "delivered"), gt(supportRequest.lastActivityAt, monthAgo)),
      ),
    )
    .orderBy(asc(supportRequest.createdAt));
  return rows.map((r) => ({ ...r.request, authorName: r.authorName, authorEmail: r.authorEmail }));
}

export async function getSupportRequestForAdmin(id: string): Promise<AdminRequestDetail | null> {
  const [row] = await db
    .select({
      request: supportRequest,
      authorId: user.id,
      authorName: user.name,
      authorEmail: user.email,
      proSlug: professional.slug,
      businessName: professional.businessName,
    })
    .from(supportRequest)
    .innerJoin(user, eq(user.id, supportRequest.userId))
    .leftJoin(professional, eq(professional.userId, user.id))
    .where(eq(supportRequest.id, id))
    .limit(1);
  if (!row) return null;
  return {
    request: row.request,
    author: {
      id: row.authorId,
      name: row.authorName,
      email: row.authorEmail,
      proSlug: row.proSlug,
      businessName: row.businessName,
    },
    thread: await getThread(id),
  };
}
