import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { EventList } from "@/components/dashboard/event-list";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { getEventsPage } from "@/server/catalog-queries";
import { requireProfessional } from "@/server/pro-context";

export const metadata: Metadata = { title: "Événements" };

export default async function EventsPage() {
  const pro = await requireProfessional();
  const { live, ended } = await getEventsPage(pro.id);

  // With no event at all, the empty state carries the button: one call to action per intent.
  const isEmpty = live.length === 0 && ended.length === 0;
  const newEvent = (
    <Button asChild>
      <Link href="/dashboard/events/new">
        <Plus aria-hidden />
        Nouvel événement
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Événements"
        description="Vos cours et vos ateliers, ponctuels ou récurrents."
        action={isEmpty ? undefined : newEvent}
      />
      {isEmpty ? (
        <EmptyState
          icon={CalendarDays}
          title="Créez votre premier événement"
          description="Un cours ponctuel ou récurrent, avec ses places et les tickets qu'il accepte."
          action={newEvent}
        />
      ) : (
        <EventList live={live} ended={ended} tz={pro.timezone} now={new Date()} />
      )}
    </>
  );
}
