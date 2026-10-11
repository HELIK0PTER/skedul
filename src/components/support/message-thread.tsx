import { CircleCheck, LifeBuoy, Lock, RotateCcw, X } from "lucide-react";

import { AttachmentGrid } from "@/components/support/attachment-grid";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateTimeShort } from "@/lib/datetime";
import { STAGE_LABELS } from "@/lib/support";
import { cn, initials } from "@/lib/utils";
import type { ThreadMessage } from "@/server/support-queries";

type Viewer = "user" | "admin";

/** The conversation: messages as bubbles, step and status changes as centred events. */
export function MessageThread({
  thread,
  viewer,
  className,
}: {
  thread: ThreadMessage[];
  viewer: Viewer;
  className?: string;
}) {
  return (
    <ol aria-label="Fil de la demande" className={cn("space-y-5", className)}>
      {thread.map((m) => (
        <li key={m.id}>
          {m.kind === "message" ? (
            <Bubble message={m} viewer={viewer} />
          ) : (
            <ThreadEvent message={m} viewer={viewer} />
          )}
        </li>
      ))}
    </ol>
  );
}

function authorLabel(m: ThreadMessage, viewer: Viewer): string {
  if (m.authorRole === "admin") return viewer === "user" ? "Équipe Skedul" : (m.authorName ?? "Admin");
  if (m.authorRole === "user") return viewer === "user" ? "Vous" : (m.authorName ?? "Compte supprimé");
  return "Skedul";
}

function Bubble({ message: m, viewer }: { message: ThreadMessage; viewer: Viewer }) {
  const mine = m.authorRole === viewer;
  const team = m.authorRole === "admin";
  return (
    <article className={cn("flex gap-3", mine && "flex-row-reverse")}>
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          team ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {team && viewer === "user" ? <LifeBuoy className="size-4" /> : initials(m.authorName ?? "?")}
      </span>
      <div className={cn("min-w-0 max-w-[min(36rem,85%)]", mine && "flex flex-col items-end")}>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{authorLabel(m, viewer)}</span>,{" "}
          {formatDateTimeShort(m.createdAt, ADMIN_TZ)}
        </p>
        {m.body && (
          <div
            className={cn(
              "mt-1.5 whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-[0.9375rem] leading-relaxed",
              mine ? "rounded-tr-md bg-primary-muted" : "rounded-tl-md border border-border bg-card",
            )}
          >
            {m.body}
          </div>
        )}
        <AttachmentGrid attachments={m.attachments} className={cn(mine && "justify-end")} />
      </div>
    </article>
  );
}

function ThreadEvent({ message: m, viewer }: { message: ThreadMessage; viewer: Viewer }) {
  let icon = <CircleCheck className="size-3.5" aria-hidden />;
  let text = "";
  if (m.kind === "stage_change" && m.stage) {
    text = `Étape «\u00a0${STAGE_LABELS[m.stage]}\u00a0»`;
  } else if (m.resolution === "declined") {
    icon = <X className="size-3.5" aria-hidden />;
    text = "Demande non retenue";
  } else if (m.resolution === "closed") {
    icon = <Lock className="size-3.5" aria-hidden />;
    text = "Demande fermée";
  } else {
    icon = <RotateCcw className="size-3.5" aria-hidden />;
    text = "Demande rouverte";
  }
  const by = viewer === "admin" && m.authorRole === "admin" && m.authorName ? ` par ${m.authorName}` : "";
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {icon}
        <span>
          <span className="font-medium text-foreground">{text}</span>
          {by}, {formatDateTimeShort(m.createdAt, ADMIN_TZ)}
        </span>
      </p>
      {m.body && (
        <p className="max-w-lg whitespace-pre-wrap rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {m.body}
        </p>
      )}
    </div>
  );
}
