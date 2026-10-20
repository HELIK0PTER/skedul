"use server";

import {
  closeTicketsCore,
  convertTicketsCore,
  createCustomerCore,
  offerTicketsCore,
  pointTicketsCore,
  retireTicketsCore,
  revokeLinksCore,
  unpointTicketsCore,
  updateCustomerCore,
} from "@/lib/back-office/client-actions";
import type { ActionResult } from "@/lib/back-office/result";
import type { DateKey } from "@/lib/civil-date";
import { db } from "@/lib/db";
import { runProAction } from "@/server/pro-context";

// Clients and wallets: every action revalidates the dashboard layout (runProAction); no public page changes.

export async function createCustomerAction(input: {
  name: string;
  email: string;
  phone: string | null;
}): Promise<ActionResult<{ customerId: string; created: boolean }>> {
  return runProAction("createCustomer", (ctx, now) => createCustomerCore(db, ctx, input, now));
}

export async function updateCustomerAction(input: {
  customerId: string;
  name: string;
  phone: string | null;
}): Promise<ActionResult> {
  return runProAction("updateCustomer", (ctx, now) => updateCustomerCore(db, ctx, input, now));
}

export async function revokeLinksAction(input: { customerId: string }): Promise<ActionResult> {
  return runProAction("revokeLinks", (ctx, now) => revokeLinksCore(db, ctx, input, now));
}

export async function offerTicketsAction(input: {
  customerId: string;
  ticketTypeId: string;
  quantity: number;
  lastValidDay: DateKey | null;
  reason: string | null;
  notify: boolean;
}): Promise<ActionResult<{ count: number }>> {
  return runProAction("offerTickets", (ctx, now) => offerTicketsCore(db, ctx, input, now));
}

export async function convertTicketsAction(input: {
  customerId: string;
  ticketIds: string[];
  toTicketTypeId: string;
}): Promise<ActionResult<{ count: number }>> {
  return runProAction("convertTickets", (ctx, now) => convertTicketsCore(db, ctx, input, now));
}

export async function closeTicketsAction(input: {
  customerId: string;
  ticketIds: string[];
  reason: "rembourse" | "compense" | "autre";
  note: string | null;
}): Promise<ActionResult<{ count: number }>> {
  return runProAction("closeTickets", (ctx, now) => closeTicketsCore(db, ctx, input, now));
}

export async function retireTicketsAction(input: {
  customerId: string;
  ticketIds: string[];
  note: string | null;
}): Promise<ActionResult<{ count: number }>> {
  return runProAction("retireTickets", (ctx, now) => retireTicketsCore(db, ctx, input, now));
}

export async function pointTicketsAction(input: {
  customerId: string;
  ticketIds: string[];
  note: string | null;
}): Promise<ActionResult<{ count: number }>> {
  return runProAction("pointTickets", (ctx, now) => pointTicketsCore(db, ctx, input, now));
}

export async function unpointTicketsAction(input: {
  customerId: string;
  ticketIds: string[];
}): Promise<ActionResult<{ count: number }>> {
  return runProAction("unpointTickets", (ctx, now) => unpointTicketsCore(db, ctx, input, now));
}
