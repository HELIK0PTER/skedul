/**
 * Postgres error → engine outcome (spec § 10 table). Pure; reads both error
 * shapes through pgErrorInfo (in batch: NeonDbError; outside: DrizzleQueryError.cause).
 */
import { isEngineErrorCode, type EngineErrorCode } from "@/lib/tickets";

import { pgErrorInfo, skedulCode } from "./pg-error";

export type MappedDbError =
  | { type: "code"; code: EngineErrorCode }
  /** skedul:already_paid: a duplicate fulfillment, a success without effect. */
  | { type: "duplicate" }
  /** 40P01: atomic() replays the same batch once. */
  | { type: "deadlock" }
  /** Anything else (incl. 23505 other than booking_active_uq): rethrow. */
  | { type: "unknown" };

/** Named CHECKs with their own code; every other named CHECK maps to `invalid`. */
export const CHECK_CODES: Readonly<Record<string, EngineErrorCode>> = {
  occurrence_seats_chk: "full",
  ticket_retire_paid_chk: "retire_paid",
};

export function mapDbError(err: unknown, ctx: "write" | "delete"): MappedDbError {
  const info = pgErrorInfo(err);
  switch (info.code) {
    case "P0001": {
      const code = skedulCode(err);
      if (code === "already_paid") return { type: "duplicate" };
      return code && isEngineErrorCode(code) ? { type: "code", code } : { type: "unknown" };
    }
    case "23514":
      return { type: "code", code: (info.constraint && CHECK_CODES[info.constraint]) || "invalid" };
    case "23505":
      return info.constraint === "booking_active_uq"
        ? { type: "code", code: "already_booked" }
        : { type: "unknown" };
    case "23P01":
      return info.constraint === "occurrence_rdv_excl"
        ? { type: "code", code: "slot_taken" }
        : { type: "unknown" };
    case "23503":
      return { type: "code", code: ctx === "delete" ? "in_use" : "stale" };
    case "40P01":
      return { type: "deadlock" };
    default:
      return { type: "unknown" };
  }
}

/** A constraint name as Postgres writes ours (snake case, at most 63 characters); anything else is not copied. */
const CONSTRAINT_NAME = /^[a-z0-9_]{1,63}$/;

/**
 * The line tryAtomic logs (console.warn) when an answer comes from a fallback that can also hide an engine bug (P6
 * A18): a CHECK (23514: `occurrence_seats_chk` reads `full` for a seat count below 0 too, an unnamed or other CHECK
 * reads `invalid`) and a foreign key (23503: `stale` or `in_use`). Only the SQLSTATE, the constraint name and the
 * code: never the error's message, detail or parameters (they can carry a client's data). Null for a precise answer.
 */
export function fallbackNote(err: unknown, mapped: MappedDbError): string | null {
  if (mapped.type !== "code") return null;
  const info = pgErrorInfo(err);
  if (info.code !== "23514" && info.code !== "23503") return null;
  const name = info.constraint && CONSTRAINT_NAME.test(info.constraint) ? info.constraint : "unnamed";
  return `[db] ${info.code} ${name} -> ${mapped.code}`;
}
