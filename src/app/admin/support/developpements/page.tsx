import type { Metadata } from "next";

import { DevBoardCard } from "@/components/admin/dev-board-card";
import { SupportTabs } from "@/components/admin/support-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireAdmin } from "@/lib/admin";
import { STAGE_LABELS, TRACK_STEPS } from "@/lib/support";
import { getDevBoard } from "@/server/support-queries";

export const metadata: Metadata = { title: "Développements" };

// "Reçue" is never a development column: accepting starts at "Acceptée".
const COLUMNS = TRACK_STEPS.development.filter((s) => s !== "received");

export default async function DevBoardPage() {
  await requireAdmin();
  const cards = await getDevBoard();

  return (
    <>
      <PageHeader title="Support" description="Les demandes acceptées en développement, par étape." />
      <SupportTabs active="board" />

      <div className="-mx-5 overflow-x-auto px-5 pb-2">
        <div className="grid min-w-[60rem] grid-cols-5 gap-3">
          {COLUMNS.map((stage, i) => {
            const items = cards.filter((c) => c.stage === stage);
            return (
              <section
                key={stage}
                aria-labelledby={`col-${stage}`}
                className="flex min-h-72 flex-col rounded-2xl bg-muted/70 p-3"
              >
                <h2 id={`col-${stage}`} className="flex items-center justify-between px-1 text-sm font-semibold">
                  {STAGE_LABELS[stage]}
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </h2>
                {items.length === 0 ? (
                  <p className="mt-3 px-1 text-xs text-muted-foreground">Aucune demande</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {items.map((c) => (
                      <li key={c.id}>
                        <DevBoardCard
                          card={{
                            id: c.id,
                            number: c.number,
                            subject: c.subject,
                            authorName: c.authorName,
                            eta: c.eta,
                          }}
                          prev={COLUMNS[i - 1] ?? null}
                          next={COLUMNS[i + 1] ?? null}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Les demandes livrées restent affichées 30 jours. Chaque déplacement prévient l’utilisateur par e-mail.
      </p>
    </>
  );
}
