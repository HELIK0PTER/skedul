// Usage: ./node_modules/.bin/tsx scripts/spike/run.ts [S1 S4 …]  (no id = all)
import { assertSpikeBranch, runCheck, type CheckResult } from "./db";
import { CHECKS } from "./checks";

async function main() {
  await assertSpikeBranch();
  const wanted = process.argv.slice(2).map((s) => s.toUpperCase());
  const results: CheckResult[] = [];
  for (const c of CHECKS) {
    if (wanted.length && !wanted.some((w) => c.id.toUpperCase() === w || c.id.toUpperCase().startsWith(w))) continue;
    results.push(await runCheck(c));
  }
  console.info("| Check | Résultat | Durée | Détail |");
  console.info("|---|---|---|---|");
  for (const r of results) {
    const detail = r.detail.replace(/\|/g, "/").replace(/\s+/g, " ");
    console.info(`| ${r.id} ${r.title} | ${r.ok ? "PASS" : "FAIL"} | ${r.ms} ms | ${detail} |`);
  }
  if (results.length === 0) console.info("(no check selected)");
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
