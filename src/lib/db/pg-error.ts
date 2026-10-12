/**
 * Postgres error details, whatever the path that threw them. Inside
 * `db.batch` neon-http throws its NeonDbError directly; outside, drizzle wraps
 * it in a DrizzleQueryError whose `.cause` is the NeonDbError. Duck-typed on
 * purpose: @neondatabase/serverless ships two builds (CJS/ESM), so there can
 * be two NeonDbError classes and `instanceof` is unreliable.
 */
export type PgErrorInfo = {
  code?: string;
  constraint?: string;
  detail?: string;
  message: string;
};

// A SQLSTATE: 5 chars, class first. Excludes Node errno codes ("ECONNRESET").
const SQLSTATE = /^[0-9A-DF-Z][0-9A-Z]{4}$/;

type ErrLike = {
  code?: unknown;
  constraint?: unknown;
  detail?: unknown;
  message?: unknown;
  cause?: unknown;
};

export function pgErrorInfo(err: unknown): PgErrorInfo {
  let cur: unknown = err;
  for (let depth = 0; cur != null && depth < 5; depth++) {
    const e = cur as ErrLike;
    if (typeof e.code === "string" && SQLSTATE.test(e.code)) {
      return {
        code: e.code,
        constraint: typeof e.constraint === "string" ? e.constraint : undefined,
        detail: typeof e.detail === "string" ? e.detail : undefined,
        message: typeof e.message === "string" ? e.message : String(cur),
      };
    }
    cur = typeof cur === "object" ? e.cause : undefined;
  }
  let inner: unknown = err;
  while (inner instanceof Error && inner.cause instanceof Error) inner = inner.cause;
  return { message: inner instanceof Error ? inner.message : String(inner) };
}

/** `stale` for an error raised by `skedul_assert(…, 'stale')`, else null. */
export function skedulCode(err: unknown): string | null {
  const info = pgErrorInfo(err);
  if (info.code !== "P0001") return null;
  const m = /skedul:([a-z_]+)/.exec(info.message);
  return m ? m[1] : null;
}
