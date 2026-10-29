/**
 * The pro's own client search (A31): a substring match that ignores case and accents, so « Elodie » finds « Élodie »
 * and the reverse. `unaccent` (installed by migration 0013) folds BOTH the column and the typed text, then ILIKE
 * ignores the case. Every caller adds its own professional_id filter: this fragment only matches text.
 */
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/** « %q% » for `ILIKE … ESCAPE '!'`: `!`, `%` and `_` typed by the pro are literal characters (the backslash is not special). */
export function likePattern(q: string): string {
  return `%${q.replace(/[!%_]/g, "!$&")}%`;
}

/** `column` contains `q`, case and accents ignored on both sides. */
export function foldedContains(column: SQLWrapper, q: string): SQL {
  return sql`unaccent(${column}) ilike unaccent(${likePattern(q)}) escape '!'`;
}

/** The sort key that matches the search: lowercase, accents folded (the final French order is the JS collator's). */
export function foldedSortKey(column: SQLWrapper): SQL {
  return sql`lower(unaccent(${column}))`;
}
