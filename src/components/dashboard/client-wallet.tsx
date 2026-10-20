import { Ticket } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { StatusMark } from "@/components/dashboard/status-mark";
import { TypeChip } from "@/components/dashboard/type-chip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TypeOption } from "@/lib/back-office/catalog-reads";
import { formatCount, plural } from "@/lib/back-office/format";
import type { WalletGroup, WalletTicketView } from "@/lib/back-office/wallet-view";
import type { DateKey } from "@/lib/civil-date";
import { cn } from "@/lib/utils";

type ClientWalletProps = {
  customerId: string;
  groups: WalletGroup[];
  typeOptions: TypeOption[];
  todayKey: DateKey;
};

/** One ticket: origin and state (« Acheté · Disponible · valable jusqu'au 12/01 inclus »). A closed one is struck through and stays readable (zinc-600 on white). */
function TicketLine({ view }: { view: WalletTicketView }) {
  return (
    <li
      className={cn(
        "text-sm wrap-anywhere",
        view.tone === "red" && "text-rose-700",
        view.tone === "muted" && "text-zinc-600",
        view.struck && "line-through",
      )}
    >
      {view.origin} · {view.line}
    </li>
  );
}

/**
 * The alert (Q28) belongs to the group: it is written once under the type, with its mark. The mark is decorative
 * because the text next to it says the same thing.
 */
function GroupAlert({ alert }: { alert: NonNullable<WalletGroup["alert"]> }) {
  return alert === "red" ? (
    <p className="flex items-start gap-2 text-sm text-rose-700">
      <StatusMark tone="red" decorative className="mt-1.5" />
      <span>Type archivé : ces tickets ne servent plus. Proposez « Convertir ».</span>
    </p>
  ) : (
    <p className="flex items-start gap-2 text-sm text-warning">
      <StatusMark tone="orange" decorative className="mt-1.5" />
      <span>Lié à aucun événement à venir.</span>
    </p>
  );
}

function WalletGroupSection({ group }: { group: WalletGroup }) {
  const live = [...group.usable, ...group.booked, ...group.expired];
  return (
    <section aria-label={group.name} className="space-y-3 py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="min-w-0 text-sm font-semibold wrap-anywhere">
          <TypeChip name={group.name} color={group.color} archived={group.archived} />
        </h4>
        {/* Task 35 anchor: <WalletGroupActions customerId={customerId} group={{ ticketTypeId: group.ticketTypeId, name: group.name, ids: group.ids }} typeOptions={typeOptions} /> */}
      </div>

      {group.alert && <GroupAlert alert={group.alert} />}

      <div>
        <p className="text-sm font-medium">{plural(group.usableCount, "ticket utilisable", "tickets utilisables")}</p>
        {group.expirySummary.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-zinc-600">
            {group.expirySummary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>

      {live.length > 0 && (
        <ul className="space-y-1">
          {live.map((view) => (
            <TicketLine key={view.id} view={view} />
          ))}
        </ul>
      )}

      {group.done.length > 0 && (
        <details>
          <summary className="cursor-pointer rounded text-sm text-zinc-600 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {`Utilisés et clos (${formatCount(group.done.length)})`}
          </summary>
          <ul className="mt-2 space-y-1">
            {group.done.map((view) => (
              <TicketLine key={view.id} view={view} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** « Portefeuille »: one section per ticket type the client holds tickets of (read-only until Task 35). */
export function ClientWallet({ groups }: ClientWalletProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Portefeuille</CardTitle>
        {/* Task 35 anchor: <OfferTicketsButton customerId={customerId} typeOptions={typeOptions} todayKey={todayKey} /> */}
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <EmptyState icon={Ticket} title="Aucun ticket" />
        ) : (
          <div className="divide-y divide-border">
            {groups.map((group) => (
              <WalletGroupSection key={group.ticketTypeId} group={group} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
