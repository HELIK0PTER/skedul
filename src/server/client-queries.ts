import "server-only";

import type { ClientFilter } from "@/lib/back-office/client-filters";
import {
  getClientRecord,
  listClients,
  type ClientListRow,
  type ClientRecordData,
} from "@/lib/back-office/client-reads";
import { db } from "@/lib/db";

/** The clients page: listed clients matching the filter and the search, plus the count of every filter. */
export async function getClientsPage(
  professionalId: string,
  opts: { q: string; filter: ClientFilter },
): Promise<{ rows: ClientListRow[]; counts: Record<ClientFilter, number> }> {
  return listClients(db, professionalId, new Date(), opts);
}

/** The client record page (null for another pro's or an unknown customer: the page answers notFound()). */
export async function getClientRecordPage(
  professionalId: string,
  customerId: string,
): Promise<ClientRecordData | null> {
  return getClientRecord(db, professionalId, customerId, new Date());
}
