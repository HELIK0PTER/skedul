import "server-only";

import { unstable_rethrow } from "next/navigation";

import { safeReadWith } from "@/lib/safe-read";

/**
 * Every server-only read a public page, a layout or a generateMetadata runs goes through this, in the form
 * `return safeRead(() => core(db, ..., now))` (src/server/safe-read.test.ts): a failed query throws `[read] <SQL head>`,
 * never Drizzle's « Failed query: … params: … » with the visitor's e-mail, and a Next control-flow error (notFound,
 * redirect, the dynamic-usage bailout of cookies() / headers() during a prerender, a postpone) still reaches Next
 * unchanged through `unstable_rethrow`. The rule is the tested `safeReadWith` (src/lib/safe-read.ts).
 */
export function safeRead<T>(fn: () => Promise<T>): Promise<T> {
  return safeReadWith(fn, unstable_rethrow);
}
