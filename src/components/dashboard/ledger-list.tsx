import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/lib/back-office/format";
import type { HistoryLine } from "@/lib/back-office/history";

const VISIBLE_LINES = 30;

function Lines({ lines }: { lines: HistoryLine[] }) {
  return (
    <ol className="divide-y divide-border">
      {lines.map((line) => (
        <li key={line.key} className="py-2 text-sm wrap-anywhere first:pt-0 last:pb-0">
          {line.text}
        </li>
      ))}
    </ol>
  );
}

/** « Historique »: the client's ledger as readable lines, newest action first. */
export function LedgerList({ lines }: { lines: HistoryLine[] }) {
  const shown = lines.slice(0, VISIBLE_LINES);
  const rest = lines.slice(VISIBLE_LINES);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historique</CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-600">Aucun mouvement.</p>
        ) : (
          <>
            <Lines lines={shown} />
            {rest.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer rounded text-sm text-zinc-600 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {`Afficher tout l'historique (${formatCount(rest.length)})`}
                </summary>
                <div className="mt-3">
                  <Lines lines={rest} />
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
