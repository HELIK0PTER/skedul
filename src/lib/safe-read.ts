/**
 * The tested core of `safeRead` (`src/server/safe-read.ts`), the wrapper of every server-only read a public page, a
 * layout or a generateMetadata runs during its render (P4 final review RND-1, contract § 1 « URLs and logs »). Pure: the
 * control-flow check (Next's `unstable_rethrow`) is passed in, so node:test runs the rule with a fake.
 *
 * Why: when a query fails, Drizzle throws `DrizzleQueryError`, whose message and stack start with « Failed query: <sql>
 * params: <values> » and whose cause is the driver error; a page that lets it propagate makes Next.js log it as it is,
 * so a transient Neon failure would write the session e-mail a visitor read binds (and any other value) into the
 * runtime log. A read wrapped here throws instead an error that carries the scrubbed message only.
 */
import { logSafeMessage } from "@/lib/log-safe";

/** The errors this module threw: a read wrapped inside another (resolvePublicPro reads getPublicPage) passes them on as they are. */
const scrubbed = new WeakSet<Error>();

/**
 * Awaits `fn()`. On a throw: `rethrowIfControlFlow(err)` first (notFound, redirect, a dynamic-usage bailout or a
 * postpone must reach Next unchanged), then a new `Error("[read] " + logSafeMessage(err))`: no `cause`, nothing copied
 * from the raw error or its stack, so neither the parameters nor the driver's message can reach a log line. The page's
 * error boundary still renders, and Next's digest still pairs the error page with that one safe log line.
 */
export async function safeReadWith<T>(fn: () => Promise<T>, rethrowIfControlFlow: (e: unknown) => void): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    rethrowIfControlFlow(err);
    if (err instanceof Error && scrubbed.has(err)) throw err;
    const safe = new Error("[read] " + logSafeMessage(err));
    scrubbed.add(safe);
    throw safe;
  }
}
