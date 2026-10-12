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
