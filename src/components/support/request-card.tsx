import Link from "next/link";

import { StageProgress } from "@/components/support/stage-progress";
import { SupportTypeChip } from "@/components/support/support-type";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateShort } from "@/lib/datetime";
import type { SupportRequestRow } from "@/server/support-queries";

export function RequestCard({ request }: { request: SupportRequestRow }) {
  return (
    <Link
      href={`/aide/demandes/${request.id}`}
      className="group block rounded-2xl border border-border bg-card p-5 shadow-(--shadow-card) transition-[border-color,translate] duration-150 hover:border-primary/40 motion-safe:hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <SupportTypeChip type={request.type} />
            <span className="tabular-nums">#{request.number}</span>
          </div>
          <p className="mt-2 truncate font-semibold transition-colors group-hover:text-primary">
            {request.subject}
          </p>
        </div>
        {request.unreadByUser && (
          <span className="shrink-0 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
            Nouvelle réponse
          </span>
        )}
      </div>
      <StageProgress
        size="mini"
        track={request.track}
        stage={request.stage}
        resolution={request.resolution}
        className="mt-4"
      />
      <p className="mt-3 text-xs text-muted-foreground">
        Dernière activité le {formatDateShort(request.lastActivityAt, ADMIN_TZ)}
      </p>
    </Link>
  );
}
