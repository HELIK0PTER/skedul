/**
 * Help center and support requests: the pure rules shared by the server
 * actions, the pages and the e-mails. No drizzle and no Node APIs, so client
 * components can import it; the schema builds its enums from the arrays below.
 */

/* ── Vocabulary ── */

export const SUPPORT_TYPES = ["question", "bug", "feature", "other"] as const;
export type SupportType = (typeof SUPPORT_TYPES)[number];

export const SUPPORT_TRACKS = ["support", "development"] as const;
export type SupportTrack = (typeof SUPPORT_TRACKS)[number];

export const SUPPORT_STAGES = [
  "received",
  "in_progress",
  "resolved",
  "accepted",
  "planned",
  "in_development",
  "testing",
  "delivered",
] as const;
export type SupportStage = (typeof SUPPORT_STAGES)[number];

export const SUPPORT_RESOLUTIONS = ["declined", "closed"] as const;
export type SupportResolution = (typeof SUPPORT_RESOLUTIONS)[number];

export const SUPPORT_AUTHOR_ROLES = ["user", "admin", "system"] as const;
export type SupportAuthorRole = (typeof SUPPORT_AUTHOR_ROLES)[number];

export const SUPPORT_MESSAGE_KINDS = ["message", "stage_change", "resolution"] as const;
export type SupportMessageKind = (typeof SUPPORT_MESSAGE_KINDS)[number];

/** Icons a FAQ category may use; the UI maps each name to a lucide icon. */
export const HELP_ICONS = [
  "rocket",
  "calendar",
  "ticket",
  "credit-card",
  "user",
  "settings",
  "help",
  "sparkles",
] as const;
export type HelpIcon = (typeof HELP_ICONS)[number];

export function isHelpIcon(value: string): value is HelpIcon {
  return (HELP_ICONS as readonly string[]).includes(value);
}

export const TYPE_LABELS: Record<SupportType, string> = {
  question: "Question",
  bug: "Problème",
  feature: "Idée de fonctionnalité",
  other: "Autre",
};

export const TYPE_HINTS: Record<SupportType, string> = {
  question: "Comment faire quelque chose avec Skedul",
  bug: "Quelque chose ne fonctionne pas comme prévu",
  feature: "Une fonctionnalité qui vous manque",
  other: "Compte, facturation ou autre sujet",
};

export const STAGE_LABELS: Record<SupportStage, string> = {
  received: "Reçue",
  in_progress: "Prise en charge",
  resolved: "Résolue",
  accepted: "Acceptée",
  planned: "Planifiée",
  in_development: "En développement",
  testing: "En test",
  delivered: "Livrée",
};

export const RESOLUTION_LABELS: Record<SupportResolution, string> = {
  declined: "Non retenue",
  closed: "Fermée",
};

/* ── Limits ── */

export const MAX_REQUESTS_PER_DAY = 5;
export const MAX_MESSAGES_PER_DAY = 30;
export const MAX_SUBJECT = 140;
export const MAX_BODY = 20_000;
export const MAX_ATTACHMENTS = 3;
/**
 * One image as the server receives it, after the browser shrank it
 * (`src/lib/shrink-image.ts`): 3 of them plus a full message stay under
 * Vercel's 4.5 MB request-body cap.
 */
export const MAX_ATTACHMENT_BYTES = 1_300_000;
/** A picked file before shrinking (checked in the browser only). */
export const MAX_SOURCE_IMAGE_BYTES = 20_000_000;
/** Longest side, in px, of a shrunk image. */
export const MAX_IMAGE_EDGE = 2000;

export const ATTACHMENT_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export type AttachmentType = keyof typeof ATTACHMENT_EXTENSIONS;

/* ── Progress ── */

export const TRACK_STEPS: Record<SupportTrack, readonly SupportStage[]> = {
  support: ["received", "in_progress", "resolved"],
  development: ["received", "accepted", "planned", "in_development", "testing", "delivered"],
};

export type RequestState = {
  track: SupportTrack;
  stage: SupportStage;
  resolution: SupportResolution | null;
};

/** Position of `stage` on its track (0-based); 0 when it is not on the track. */
export function stepIndex(track: SupportTrack, stage: SupportStage): number {
  return Math.max(0, TRACK_STEPS[track].indexOf(stage));
}

export function stepCount(track: SupportTrack): number {
  return TRACK_STEPS[track].length;
}

/** 0 on the first step, 1 on the last. */
export function progressRatio(track: SupportTrack, stage: SupportStage): number {
  return stepIndex(track, stage) / (stepCount(track) - 1);
}

export function isFinalStage(track: SupportTrack, stage: SupportStage): boolean {
  const steps = TRACK_STEPS[track];
  return steps[steps.length - 1] === stage;
}

/** Still being worked on: no resolution and not on the track's last step. */
export function isOpen(r: RequestState): boolean {
  return r.resolution === null && !isFinalStage(r.track, r.stage);
}

export function statusLabel(r: RequestState): string {
  return r.resolution ? RESOLUTION_LABELS[r.resolution] : STAGE_LABELS[r.stage];
}

/**
 * The admin may move a request to any step of its own track, backwards
 * included, except a development request back to "received" (the kanban
 * starts at "accepted").
 */
export function canSetStage(track: SupportTrack, stage: SupportStage): boolean {
  if (track === "development" && stage === "received") return false;
  return TRACK_STEPS[track].includes(stage);
}

export function canAcceptForDevelopment(r: RequestState): boolean {
  return r.track === "support" && r.resolution === null && r.stage !== "resolved";
}

/** A closed request is locked; declined or delivered ones still accept replies. */
export function canUserReply(r: RequestState): boolean {
  return r.resolution !== "closed";
}

/** A reply on a resolved support request reopens it; nothing else moves. */
export function stageAfterUserReply(r: RequestState): SupportStage {
  return r.track === "support" && r.stage === "resolved" && r.resolution === null
    ? "in_progress"
    : r.stage;
}

/** The first admin reply on a new support request means it is being handled. */
export function stageAfterAdminReply(r: RequestState): SupportStage {
  return r.track === "support" && r.stage === "received" && r.resolution === null
    ? "in_progress"
    : r.stage;
}

type ThreadEvent = {
  kind: SupportMessageKind;
  stage: SupportStage | null;
  createdAt: Date;
};

/**
 * When each step was last entered: "received" at creation, the others from
 * the `stage_change` events (expected in chronological order).
 */
export function stageReachedAt(
  createdAt: Date,
  events: readonly ThreadEvent[],
): Partial<Record<SupportStage, Date>> {
  const reached: Partial<Record<SupportStage, Date>> = { received: createdAt };
  for (const e of events) {
    if (e.kind === "stage_change" && e.stage) reached[e.stage] = e.createdAt;
  }
  return reached;
}

/* ── Admin inbox ── */

export const INBOX_FILTERS = ["todo", "open", "done", "all"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_FILTER_LABELS: Record<InboxFilter, string> = {
  todo: "À traiter",
  open: "En cours",
  done: "Terminées",
  all: "Toutes",
};

export const INBOX_PAGE_SIZE = 25;

export function parseInboxFilter(value: string | undefined): InboxFilter {
  return (INBOX_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as InboxFilter)
    : "todo";
}

export function parseSupportType(value: string | undefined): SupportType | null {
  return (SUPPORT_TYPES as readonly string[]).includes(value ?? "")
    ? (value as SupportType)
    : null;
}

/* ── Ordering (FAQ categories and articles) ── */

/** `ids` with `id` swapped with its neighbour, or null when it cannot move. */
export function moveInList(
  ids: readonly string[],
  id: string,
  direction: "up" | "down",
): string[] | null {
  const from = ids.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/* ── Attachments ── */

export type AttachmentCheck = { ok: true } | { ok: false; error: string };

export function checkAttachments(
  files: readonly { type: string; size: number }[],
): AttachmentCheck {
  if (files.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `${MAX_ATTACHMENTS} images maximum par message.` };
  }
  for (const file of files) {
    if (!Object.hasOwn(ATTACHMENT_EXTENSIONS, file.type)) {
      return { ok: false, error: "Format d’image non pris en charge (png, jpg ou webp)." };
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: "Image trop lourde, même après réduction." };
    }
  }
  return { ok: true };
}

/** `width`×`height` scaled so its longest side is at most `maxEdge`; never upscaled, never 0. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/* ── Estimated delivery date (YYYY-MM-DD) ── */

export function isValidEta(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** "2026-10-31" → "31 octobre". */
export function formatEta(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/* ── Age of a request ── */

/** Whole days since `createdAt`, never negative: "Ouverte aujourd’hui", "Ouverte hier", "Ouverte il y a 5 jours". */
export function ageLabel(createdAt: Date, now: Date = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000));
  if (days === 0) return "Ouverte aujourd’hui";
  if (days === 1) return "Ouverte hier";
  return `Ouverte il y a ${days} jours`;
}

/* ── FAQ search ── */

export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type SearchableArticle = { question: string; answer: string };

/**
 * Articles containing every word of `query` (accents and case ignored, one-letter
 * words skipped); articles matching more words in their question come first.
 */
export function matchArticles<T extends SearchableArticle>(
  articles: readonly T[],
  query: string,
): T[] {
  const words = normalizeSearch(query)
    .split(" ")
    .filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const hits: { article: T; inQuestion: number; order: number }[] = [];
  articles.forEach((article, order) => {
    const question = normalizeSearch(article.question);
    const answer = normalizeSearch(article.answer);
    if (!words.every((w) => question.includes(w) || answer.includes(w))) return;
    const inQuestion = words.filter((w) => question.includes(w)).length;
    hits.push({ article, inQuestion, order });
  });
  return hits
    .sort((a, b) => b.inQuestion - a.inQuestion || a.order - b.order)
    .map((h) => h.article);
}

/* ── FAQ answers: plain text → paragraphs, "- " lists and links ── */

export type AnswerSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

export type AnswerBlock =
  | { kind: "paragraph"; segments: AnswerSegment[] }
  | { kind: "list"; items: AnswerSegment[][] };

// https URLs, or app paths ("/sign-up") at the start of a line or after a space.
const LINK_RE = /https:\/\/[^\s<>()]+|(?:^|(?<=\s))\/[a-z0-9][^\s<>()]*/gi;

function linkify(line: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const match of line.matchAll(LINK_RE)) {
    const start = match.index ?? 0;
    const trailing = match[0].match(/[.,;:!?]+$/)?.[0] ?? "";
    const href = trailing ? match[0].slice(0, -trailing.length) : match[0];
    if (start > last) segments.push({ kind: "text", text: line.slice(last, start) });
    segments.push({ kind: "link", text: href, href });
    last = start + href.length;
  }
  if (last < line.length) segments.push({ kind: "text", text: line.slice(last) });
  return segments;
}

/** Rendered as React elements by <FaqAnswer />: never as raw HTML. */
export function parseAnswer(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    let paragraph: string[] = [];
    let items: AnswerSegment[][] = [];
    const flushParagraph = () => {
      if (paragraph.length) blocks.push({ kind: "paragraph", segments: linkify(paragraph.join(" ")) });
      paragraph = [];
    };
    const flushList = () => {
      if (items.length) blocks.push({ kind: "list", items });
      items = [];
    };
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("- ")) {
        flushParagraph();
        items.push(linkify(line.slice(2).trim()));
      } else {
        flushList();
        paragraph.push(line);
      }
    }
    flushParagraph();
    flushList();
  }
  return blocks;
}
