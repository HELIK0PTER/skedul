import { Badge } from "@/components/ui/badge";
import { BOOKING_STATUS_LABELS, type BookingStatus } from "@/lib/tickets-vocab";

const VARIANT = { pending: "warning", confirmed: "success", cancelled: "neutral", expired: "neutral" } as const;

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge variant={VARIANT[status]}>{BOOKING_STATUS_LABELS[status]}</Badge>;
}
