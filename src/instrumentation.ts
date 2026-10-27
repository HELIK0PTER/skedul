/**
 * Run once when a Next.js server instance starts (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 *
 * In the Node.js runtime it installs the log scrub of `src/lib/log-scrub.ts` on `console.error` and `console.warn`
 * (P4 final review RND-1, contract § 1 « URLs and logs »): no framework or library log line prints the parameters of
 * a failed query, an e-mail address or a token. The module is imported inside the runtime check, so the Edge runtime
 * never loads it. Tested in src/lib/log-scrub.test.ts.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installLogScrub } = await import("@/lib/log-scrub");
    installLogScrub(console);
  }
}
