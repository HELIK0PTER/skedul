import "server-only";

import {
  getTicketTypeDetail,
  listActiveTypeOptions,
  listTicketTypes,
  type TicketTypeDetail,
  type TicketTypeSummary,
  type TypeOption,
} from "@/lib/back-office/catalog-reads";
import {
  getEventEditor,
  listEvents,
  type EventEditorLookup,
  type EventListRow,
} from "@/lib/back-office/event-reads";
import { db } from "@/lib/db";

/*
 * Thin server-only wrappers of src/lib/back-office/catalog-reads.ts and
 * event-reads.ts: each is the read with `db` and the current instant.
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

/** The events list: one row per series on its current segment, finished series apart. */
export async function getEventsPage(
  professionalId: string,
): Promise<{ live: EventListRow[]; ended: EventListRow[] }> {
  return listEvents(db, professionalId, new Date());
}

/** The editor data of an event page (another segment of the series redirects), null for an unknown event. */
export async function getEventEditorPage(professionalId: string, eventId: string): Promise<EventEditorLookup> {
  return getEventEditor(db, professionalId, eventId, new Date());
}
