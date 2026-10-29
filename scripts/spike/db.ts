/**
 * Throwaway harness for the P1 spike. Talks ONLY to the Neon branch
 * `spike-batch` (SPIKE_DATABASE_URL in .env.spike.local) and refuses any
 * database without the marker table public.spike_marker.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/lib/db/schema";

config({ path: ".env.spike.local" });

const url = process.env.SPIKE_DATABASE_URL;
if (!url) throw new Error("SPIKE_DATABASE_URL is missing (.env.spike.local)");

export const client = neon(url);
export const db = drizzle({ client, schema });

export async function assertSpikeBranch(): Promise<void> {
  const rows = (await client.query(
    "select to_regclass('public.spike_marker')::text as marker",
  )) as { marker: string | null }[];
  if (!rows[0]?.marker) {
    throw new Error("Not the spike-batch branch (public.spike_marker missing): refusing to run.");
  }
}

const SCRATCH_DDL = [
  "create schema if not exists spike",
  "create table if not exists spike.parent (id text primary key, n int not null default 0, capacity int not null default 1, constraint parent_n_chk check (n between 0 and capacity))",
  "create table if not exists spike.child (id serial primary key, parent_id text not null)",
  "create table if not exists spike.ticket (id text primary key, status text not null)",
  "create table if not exists spike.movement (ticket_id text not null, action_id text not null, constraint movement_action_ticket_uq unique (action_id, ticket_id))",
  "create or replace function skedul_assert(ok boolean, code text) returns boolean language plpgsql as $$begin if ok is not true then raise exception using errcode = 'P0001', message = 'skedul:' || code; end if; return true; end$$",
];

/** Idempotent scratch schema `spike`, emptied before each check. */
export async function setupScratch(): Promise<void> {
  for (const stmt of SCRATCH_DDL) await client.query(stmt);
  await client.query("truncate spike.parent, spike.child, spike.ticket, spike.movement restart identity");
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type SpikeCheck = { id: string; title: string; run: () => Promise<string> };
export type CheckResult = { id: string; title: string; ok: boolean; detail: string; ms: number };

export async function runCheck(c: SpikeCheck): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const detail = await c.run();
    return { id: c.id, title: c.title, ok: true, detail, ms: Date.now() - t0 };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { id: c.id, title: c.title, ok: false, detail, ms: Date.now() - t0 };
  }
}
