import type { Metadata } from "next";
import Link from "next/link";
import { Ticket } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import {
  EventTypesManager,
  type EventTypeItem,
  type Question,
} from "@/components/dashboard/event-types-manager";
import { getCurrentProfessional } from "@/lib/session";
import { getProEventTypes, getProEventTypeRules, getEventTypeQuestions } from "@/server/queries";

export const metadata: Metadata = { title: "Prestations" };

export default async function EventTypesPage() {
  const pro = (await getCurrentProfessional())!;
  const [rows, rules] = await Promise.all([
    getProEventTypes(pro.id),
    getProEventTypeRules(pro.id),
  ]);

  const byEvent = new Map<
    string,
    { dayOfWeek: number; startMinute: number; endMinute: number }[]
  >();
  for (const r of rules) {
    if (!r.eventTypeId) continue;
    const arr = byEvent.get(r.eventTypeId) ?? [];
    arr.push({
      dayOfWeek: r.dayOfWeek,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
    });
    byEvent.set(r.eventTypeId, arr);
  }

  const items: EventTypeItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    durationMinutes: r.durationMinutes,
    priceCents: r.priceCents,
    capacity: r.capacity,
    color: r.color,
    bufferBeforeMinutes: r.bufferBeforeMinutes,
    bufferAfterMinutes: r.bufferAfterMinutes,
    isActive: r.isActive,
    availability: byEvent.get(r.id) ?? [],
  }));

  const questionsArrays = await Promise.all(
    rows.map((r) => getEventTypeQuestions(r.id)),
  );

  const questionsByEventType: Record<string, Question[]> = {};
  rows.forEach((r, i) => {
    questionsByEventType[r.id] = questionsArrays[i] as Question[];
  });

  return (
    <>
      <PageHeader
        title="Prestations"
        description="Les types de rendez-vous que vos clients peuvent réserver."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/packs">
              <Ticket className="size-4" />
              Packs prépayés
            </Link>
          </Button>
        }
      />
      <EventTypesManager items={items} questionsByEventType={questionsByEventType} />
    </>
  );
}
