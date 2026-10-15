import { Badge } from "@/components/ui/badge";
import { COVERAGE_LABELS, type BookingCoverage } from "@/lib/tickets-vocab";

const VARIANT = { ticket: "default", free: "success", guest: "neutral" } as const;

/** How a booking is covered: « Ticket », « Inscription libre » or « Invité ». */
export function CoverageBadge({ coverage }: { coverage: BookingCoverage }) {
  return <Badge variant={VARIANT[coverage]}>{COVERAGE_LABELS[coverage]}</Badge>;
}
