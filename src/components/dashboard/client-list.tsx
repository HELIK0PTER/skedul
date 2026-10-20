import Link from "next/link";

import { StatusMark } from "@/components/dashboard/status-mark";
import { TypeChip } from "@/components/dashboard/type-chip";
import { Card } from "@/components/ui/card";
import type { ClientListRow } from "@/lib/back-office/client-reads";
import { plural } from "@/lib/back-office/format";
import { ALERT_LABELS } from "@/lib/back-office/labels";

function Holdings({ row }: { row: ClientListRow }) {
  if (row.holdings.length === 0) {
    return <span className="text-zinc-600">Aucun ticket utilisable</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {row.holdings.map((h) => (
        <TypeChip key={h.ticketTypeId} name={h.name} color={h.color} archived={h.archived} count={h.usable} />
      ))}
    </div>
  );
}

/** Table cell: the marks alone, so each one keeps its accessible name and its tooltip (no visible text to rely on). */
function AlertMarks({ row }: { row: ClientListRow }) {
  if (!row.red && !row.orange) return null;
  return (
    <span className="inline-flex items-center gap-2">
      {row.red && <StatusMark tone="red" />}
      {row.orange && <StatusMark tone="orange" />}
    </span>
  );
}

/** Mobile card: the visible text names the alert, so the mark beside it is decorative. */
function AlertLines({ row }: { row: ClientListRow }) {
  if (!row.red && !row.orange) return null;
  return (
    <div className="mt-3 space-y-1">
      {row.red && (
        <p className="flex items-center gap-2 text-xs text-rose-700">
          <StatusMark tone="red" decorative />
          {ALERT_LABELS.red}
        </p>
      )}
      {row.orange && (
        <p className="flex items-center gap-2 text-xs text-warning">
          <StatusMark tone="orange" decorative />
          {ALERT_LABELS.orange}
        </p>
      )}
    </div>
  );
}

/** Clients of the pro: a table from 640 px, cards below. Every row opens the client record. */
export function ClientList({ rows }: { rows: ClientListRow[] }) {
  return (
    <>
      <Card className="hidden overflow-hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Vos clients</caption>
            <thead className="bg-muted/50 text-left text-xs text-zinc-600">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-medium">Client</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Tickets</th>
                <th scope="col" className="px-3 py-2.5 font-medium">À venir</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Alertes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/40">
                  <td className="min-w-40 px-3 py-3">
                    <Link href={`/dashboard/clients/${r.id}`} className="font-medium wrap-anywhere hover:underline">
                      {r.name}
                    </Link>
                    <p className="text-xs text-zinc-600 wrap-anywhere">{r.email}</p>
                  </td>
                  <td className="px-3 py-3">
                    <Holdings row={r} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-zinc-600">
                    {r.upcomingConfirmed > 0 ? plural(r.upcomingConfirmed, "inscription", "inscriptions") : "Aucune"}
                  </td>
                  <td className="px-3 py-3">
                    <AlertMarks row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ul aria-label="Vos clients" className="space-y-3 sm:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={`/dashboard/clients/${r.id}`}
              className="block rounded-2xl border border-border bg-card p-4 shadow-(--shadow-card) transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="font-medium wrap-anywhere">{r.name}</p>
              <p className="text-xs text-zinc-600 wrap-anywhere">{r.email}</p>
              <div className="mt-3 text-sm">
                <Holdings row={r} />
              </div>
              {r.upcomingConfirmed > 0 && (
                <p className="mt-2 text-xs text-zinc-600">
                  {`${plural(r.upcomingConfirmed, "inscription", "inscriptions")} à venir`}
                </p>
              )}
              <AlertLines row={r} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
