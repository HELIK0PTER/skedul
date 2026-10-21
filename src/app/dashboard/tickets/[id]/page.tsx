import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { OfferList } from "@/components/dashboard/offer-list";
import { PageHeader } from "@/components/dashboard/page-header";
import { RdvSettingsForm, TicketTypeInfoForm, TypeQuestionsForm } from "@/components/dashboard/ticket-type-editor";
import { TypeDangerZone } from "@/components/dashboard/type-danger-zone";
import { TypeHoursEditor } from "@/components/dashboard/type-hours-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { freeLockReasons } from "@/lib/back-office/rdv-form";
import { getTicketTypePage } from "@/server/catalog-queries";
import { requireProfessional } from "@/server/pro-context";

export const metadata: Metadata = { title: "Type de ticket" };

export default async function TicketTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pro = await requireProfessional();
  const type = await getTicketTypePage(pro.id, id);
  if (!type) notFound();

  const used = type.usage.tickets + type.usage.purchases + type.usage.rdvs > 0;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={type.name}
        description="Type de ticket"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/tickets">
              <ArrowLeft />
              Tous les tickets
            </Link>
          </Button>
        }
      />

      {type.archived && (
        <p role="status" className="mb-6 rounded-xl bg-amber-100 px-4 py-3 text-sm text-warning">
          Ce type est archivé : ses offres ne sont plus en vente.
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Informations</CardTitle>
          </CardHeader>
          <CardContent>
            <TicketTypeInfoForm
              ticketTypeId={type.id}
              initial={{ name: type.name, description: type.description ?? "", color: type.color }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Offres</CardTitle>
          </CardHeader>
          <CardContent>
            <OfferList
              ticketTypeId={type.id}
              offers={type.offers}
              archivedOffers={type.archivedOffers}
              currency={pro.currency}
              rdvFree={type.rdvFree}
              typeArchived={type.archived}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accepté par</CardTitle>
            <CardDescription>Les événements choisissent leurs tickets acceptés dans leur page.</CardDescription>
          </CardHeader>
          <CardContent>
            {type.acceptedBy.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{"Aucun événement n'accepte ce type."}</p>
                <Button asChild variant="secondary" size="sm">
                  <Link href="/dashboard/events/new">Créer un événement</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {type.acceptedBy.map((event) => (
                  <li key={event.eventId}>
                    <Link
                      href={`/dashboard/events/${event.eventId}`}
                      className="flex items-center justify-between gap-3 rounded-lg py-2.5 text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 truncate">{event.title}</span>
                      {event.isPrivate && <Badge variant="neutral">Privé</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>RDV libre</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <RdvSettingsForm
              ticketTypeId={type.id}
              initial={{
                rdvEnabled: type.rdvEnabled,
                rdvFree: type.rdvFree,
                rdvDurationMin: type.rdvDurationMin,
                rdvBufferBeforeMin: type.rdvBufferBeforeMin,
                rdvBufferAfterMin: type.rdvBufferAfterMin,
                rdvOverrides: type.rdvOverrides,
              }}
              proWindow={type.proWindow}
              freeLockReasons={freeLockReasons(type)}
            />
            {type.rdvEnabled && (
              <>
                <section className="space-y-4 border-t border-border pt-6">
                  <h3 className="text-base font-semibold">Horaires</h3>
                  <TypeHoursEditor ticketTypeId={type.id} ownHours={type.ownHours} globalHours={type.globalHours} />
                </section>
                <section className="space-y-4 border-t border-border pt-6">
                  <h3 className="text-base font-semibold">Questions</h3>
                  <TypeQuestionsForm ticketTypeId={type.id} questions={type.questions} />
                </section>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Archiver ou supprimer</CardTitle>
          </CardHeader>
          <CardContent>
            <TypeDangerZone
              ticketTypeId={type.id}
              name={type.name}
              archived={type.archived}
              used={used}
              acceptedBy={type.acceptedBy.map((event) => event.title)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
