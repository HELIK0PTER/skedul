import type { Metadata } from "next";
import { ChevronDown, Ticket } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { NewTicketTypeButton } from "@/components/dashboard/new-ticket-type-button";
import { PageHeader } from "@/components/dashboard/page-header";
import { TicketTypeCard } from "@/components/dashboard/ticket-type-card";
import { getTicketTypesPage } from "@/server/catalog-queries";
import { requireProfessional } from "@/server/pro-context";

export const metadata: Metadata = { title: "Tickets" };

export default async function TicketsPage() {
  const pro = await requireProfessional();
  const { active, archived } = await getTicketTypesPage(pro.id);
  const empty = active.length === 0 && archived.length === 0;

  return (
    <>
      <PageHeader
        title="Tickets"
        description="Vos types de ticket et les offres qui les vendent."
        // The empty state carries the same button: one call to action per intent.
        action={empty ? undefined : <NewTicketTypeButton />}
      />

      {empty ? (
        <EmptyState
          icon={Ticket}
          title="Créez un type de ticket, puis une offre"
          description="Un type de ticket, c'est ce qu'un événement accepte. Une offre le vend à l'unité ou en carnet."
          action={<NewTicketTypeButton />}
        />
      ) : (
        <>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun type actif : créez-en un ou désarchivez-en un.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {active.map((type) => (
                <TicketTypeCard key={type.id} type={type} currency={pro.currency} />
              ))}
            </div>
          )}

          {archived.length > 0 && (
            <details className="group mt-8 rounded-2xl border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                Types archivés ({archived.length})
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="grid gap-4 p-4 pt-0 md:grid-cols-2">
                {archived.map((type) => (
                  <TicketTypeCard key={type.id} type={type} currency={pro.currency} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </>
  );
}
