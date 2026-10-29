/**
 * Index-friendly scoping of ticket and booking through the pro's customers. Written before migration 0013 gave both
 * tables a (professional_id, status) index; the reads that use it still probe the customer_id indexes, which narrow
 * as well (P6 D2 EXPLAIN). Pure SQL fragments: no server-only, no db.
 */
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * `<column> = any(array(select … this pro's customers))` for a customer_id column of ticket or booking (a drizzle column,
 * or a literal `sql.raw("customer_id")` inside raw SQL).
 *
 * Before 0013 neither table had an index that starts with professional_id, so `professional_id = p` alone read every
 * pro's rows; it stays in the callers as the tenancy guard. The customers of one pro are few and come from an index
 * (customer_pro_email_uq); the array is an InitPlan, so the planner then probes the customer_id indexes
 * (ticket_customer_status_type_idx, booking_customer_idx) with `= ANY(array)`. An `IN (select …)` instead leaves the
 * planner free to scan the whole table and hash-join the customers, which is what it picks on a small platform.
 * The inner table is aliased, so the fragment is safe inside a single-table select (drizzle renders interpolated
 * columns unqualified there).
 */
export function inProCustomers(column: AnyColumn | SQL, professionalId: string): SQL {
  return sql`${column} = any(array(select c.id from customer c where c.professional_id = ${professionalId}))`;
}
