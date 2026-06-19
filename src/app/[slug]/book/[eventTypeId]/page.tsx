import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";

import { PublicShell } from "@/components/public/public-shell";
import { BookingFlow } from "@/components/public/booking-flow";
import { Badge } from "@/components/ui/badge";
import { groupSlotsByDay } from "@/lib/availability";
import { formatDateLong, formatTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/utils";
import { loadBookableSlots } from "@/lib/slots";
import { getPublicEventType } from "@/server/queries";

type Params = { params: Promise<{ slug: string; eventTypeId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, eventTypeId } = await params;
  const data = await getPublicEventType(slug, eventTypeId);
  if (!data) return { title: "Réservation" };
  return { title: `Réserver — ${data.eventType.title}` };
}

export default async function BookEventPage({ params }: Params) {
  const { slug, eventTypeId } = await params;
  const data = await getPublicEventType(slug, eventTypeId);
  if (!data) notFound();

  const { eventType, professional } = data;
  const slots = await loadBookableSlots(
    professional.id,
    professional.timezone,
    eventType,
  );

  const days = groupSlotsByDay(slots, professional.timezone).map((g) => {
    const label = formatDateLong(g.slots[0].start, professional.timezone);
    return {
      key: g.dayKey,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      slots: g.slots.map((s) => ({
        iso: s.start.toISOString(),
        time: formatTime(s.start, professional.timezone),
      })),
    };
  });

  return (
    <PublicShell branding={professional} backHref={`/${slug}`}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {eventType.title}
        </h1>
        {eventType.description && (
          <p className="mt-1 text-muted-foreground">{eventType.description}</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Badge variant="neutral">
            <Clock className="size-3.5" />
            {eventType.durationMinutes} min
          </Badge>
          <Badge>
            {eventType.priceCents > 0
              ? formatMoney(eventType.priceCents)
              : "Gratuit"}
          </Badge>
        </div>
      </div>

      <BookingFlow
        professionalId={professional.id}
        eventType={{
          id: eventType.id,
          title: eventType.title,
          durationMinutes: eventType.durationMinutes,
          priceCents: eventType.priceCents,
        }}
        days={days}
      />
    </PublicShell>
  );
}
