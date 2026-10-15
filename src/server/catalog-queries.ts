import "server-only";

import {
  getTicketTypeDetail,
  listActiveTypeOptions,
  listTicketTypes,
  type TicketTypeDetail,
  type TicketTypeSummary,
  type TypeOption,
} from "@/lib/back-office/catalog-reads";
import { db } from "@/lib/db";

/*
 * Thin server-only wrappers of src/lib/back-office/catalog-reads.ts: each is
 * the read with `db` and the current instant. Task 15 adds the events reads
 * (getEventsPage, getEventEditorPage) to this file.
 */

/** /dashboard/tickets */
export async function getTicketTypesPage(
  professionalId: string,
): Promise<{ active: TicketTypeSummary[]; archived: TicketTypeSummary[] }> {
  return listTicketTypes(db, professionalId, new Date());
}

/** /dashboard/tickets/[id]: null for an unknown id or another pro's type. */
export async function getTicketTypePage(professionalId: string, ticketTypeId: string): Promise<TicketTypeDetail | null> {
  return getTicketTypeDetail(db, professionalId, ticketTypeId, new Date());
}

/** The non-archived types, for the event forms. */
export async function getActiveTypeOptions(professionalId: string): Promise<TypeOption[]> {
  return listActiveTypeOptions(db, professionalId);
}
