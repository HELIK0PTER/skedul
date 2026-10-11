import { escapeHtml, layout } from "@/lib/email-layout";
import {
  RESOLUTION_LABELS,
  STAGE_LABELS,
  TYPE_LABELS,
  formatEta,
  isFinalStage,
  stepCount,
  stepIndex,
  type SupportResolution,
  type SupportStage,
  type SupportTrack,
  type SupportType,
} from "@/lib/support";

/** Templates for help-center notifications; every user-written string is escaped. */

type Mail = { subject: string; html: string };

const EXCERPT = 600;

function quote(body: string): string {
  const text = body.trim();
  if (!text) return "";
  const cut = text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text;
  return `<blockquote style="margin:16px 0;padding:12px 16px;background:#f4f4f5;border-radius:12px;color:#3f3f46;font-size:14px">${escapeHtml(cut).replace(/\n/g, "<br>")}</blockquote>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${label}</a></p>`;
}

function hello(name: string): string {
  const first = escapeHtml(name.trim().split(/\s+/)[0] ?? "");
  return `<p>Bonjour${first ? ` ${first}` : ""},</p>`;
}

/** To every admin: a user opened a request. */
export function supportNewRequestEmail(a: {
  number: number;
  subject: string;
  type: SupportType;
  authorName: string;
  authorEmail: string;
  body: string;
  url: string;
}): Mail {
  return {
    subject: `Nouvelle demande #${a.number} : ${a.subject}`,
    html: layout(`Nouvelle demande #${a.number}`, `
      <p><strong>${escapeHtml(a.subject)}</strong></p>
      <p style="color:#71717a;font-size:13px">${TYPE_LABELS[a.type]}, par ${escapeHtml(a.authorName)} (${escapeHtml(a.authorEmail)})</p>
      ${quote(a.body)}
      ${button(a.url, "Ouvrir la demande")}`),
  };
}

/** To every admin: the requester answered. */
export function supportUserReplyEmail(a: {
  number: number;
  subject: string;
  authorName: string;
  body: string;
  url: string;
}): Mail {
  return {
    subject: `Nouvelle réponse sur #${a.number} : ${a.subject}`,
    html: layout(`Nouvelle réponse sur #${a.number}`, `
      <p>${escapeHtml(a.authorName)} a répondu à <strong>${escapeHtml(a.subject)}</strong>.</p>
      ${quote(a.body)}
      ${button(a.url, "Ouvrir la demande")}`),
  };
}

/** To the requester: the team answered. */
export function supportAdminReplyEmail(a: {
  name: string;
  number: number;
  subject: string;
  body: string;
  url: string;
}): Mail {
  return {
    subject: `Votre demande #${a.number} : nouvelle réponse`,
    html: layout("L’équipe Skedul vous a répondu", `
      ${hello(a.name)}
      <p>Nouvelle réponse sur votre demande <strong>${escapeHtml(a.subject)}</strong> :</p>
      ${quote(a.body)}
      ${button(a.url, "Voir la conversation")}`),
  };
}

/** To the requester: the request moved to another step. */
export function supportStageEmail(a: {
  name: string;
  number: number;
  subject: string;
  track: SupportTrack;
  stage: SupportStage;
  eta: string | null;
  url: string;
}): Mail {
  const step = stepIndex(a.track, a.stage) + 1;
  const total = stepCount(a.track);
  const label = STAGE_LABELS[a.stage];
  return {
    subject: `Votre demande #${a.number} : ${label}`,
    html: layout("Votre demande avance", `
      ${hello(a.name)}
      <p>Votre demande <strong>${escapeHtml(a.subject)}</strong> a changé d’étape.</p>
      <p style="font-size:15px"><strong>Étape ${step} sur ${total} : ${label}</strong></p>
      ${a.eta && !isFinalStage(a.track, a.stage) ? `<p style="color:#71717a;font-size:13px">Livraison estimée : ${formatEta(a.eta)}</p>` : ""}
      ${button(a.url, "Suivre ma demande")}`),
  };
}

/** To the requester: declined, closed, or reopened (resolution = null). */
export function supportResolutionEmail(a: {
  name: string;
  number: number;
  subject: string;
  resolution: SupportResolution | null;
  reason: string;
  url: string;
}): Mail {
  const label = a.resolution ? RESOLUTION_LABELS[a.resolution] : "Rouverte";
  const intro =
    a.resolution === "declined"
      ? "Après étude, nous ne retiendrons pas cette demande pour le moment."
      : a.resolution === "closed"
        ? "Cette demande a été fermée."
        : "Cette demande a été rouverte : l’équipe s’en occupe à nouveau.";
  return {
    subject: `Votre demande #${a.number} : ${label}`,
    html: layout(`Demande ${label.toLowerCase()}`, `
      ${hello(a.name)}
      <p>${intro}</p>
      <p><strong>${escapeHtml(a.subject)}</strong></p>
      ${quote(a.reason)}
      ${button(a.url, "Voir la demande")}`),
  };
}
