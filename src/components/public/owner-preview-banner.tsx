import { Eye } from "lucide-react";

import { COPY } from "@/lib/public/messages";

/**
 * Shown to the owner of the page (an admin impersonating the owner included) on /[slug] and on the séance page. The
 * forms stay active so that the pro can test their own journey; their test bookings count in their figures
 * (spec L1349-1351, contract § 3.23).
 */
export function OwnerPreviewBanner() {
  return (
    <div role="note" className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <Eye className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 font-medium text-foreground">{COPY.OWNER_BANNER}</p>
    </div>
  );
}
