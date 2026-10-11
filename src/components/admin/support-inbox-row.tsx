import Link from "next/link";

import { StageProgress } from "@/components/support/stage-progress";
import { SupportTypeChip } from "@/components/support/support-type";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateTimeShort } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { InboxRow } from "@/server/support-queries";

export function SupportInboxRow({ row }: { row: InboxRow }) {
  return (
    <Link
      href={`/admin/support/${row.id}`}
      className="grid gap-3 px-5 py-4 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-center sm:gap-6"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {row.unreadByAdmin && (
            <span className="rounded-full bg-primary px-2 py-0.5 font-semibold text-primary-foreground">Nouveau</span>
          )}
          <span className="tabular-nums">#{row.number}</span>
          <SupportTypeChip type={row.type} />
        </div>
        <p className={cn("mt-1.5 truncate", row.unreadByAdmin ? "font-semibold" : "font-medium")}>{row.subject}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {row.authorName}, {formatDateTimeShort(row.lastActivityAt, ADMIN_TZ)}
        </p>
      </div>
      <StageProgress size="mini" track={row.track} stage={row.stage} resolution={row.resolution} />
    </Link>
  );
}
