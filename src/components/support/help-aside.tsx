import Link from "next/link";
import { LifeBuoy } from "lucide-react";

import { navPrimary } from "@/components/landing/cta";
import { StageProgress } from "@/components/support/stage-progress";
import { Button } from "@/components/ui/button";
import type { SupportRequestRow } from "@/server/support-queries";

/** Right column of the /aide hero: the user's open requests, or the way to write to the team. */
export function HelpAside({
  signedIn,
  requests,
}: {
  signedIn: boolean;
  requests: SupportRequestRow[];
}) {
  if (requests.length > 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-(--shadow-card) sm:p-6">
        <h2 className="font-display text-lg font-bold tracking-tight">Vos demandes en cours</h2>
        <ul className="mt-4 space-y-4">
          {requests.map((r) => (
            <li key={r.id}>
              <Link href={`/aide/demandes/${r.id}`} className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                <p className="truncate text-sm font-medium transition-colors group-hover:text-primary">
                  {r.subject}
                </p>
                <StageProgress
                  size="mini"
                  track={r.track}
                  stage={r.stage}
                  resolution={r.resolution}
                  className="mt-2"
                />
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button asChild size="sm" className={navPrimary}>
            <Link href="/aide/demandes/nouvelle">Créer une demande</Link>
          </Button>
          <Link href="/aide/demandes" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Toutes mes demandes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-accent p-6 sm:p-7">
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <LifeBuoy className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-xl font-bold tracking-tight">Une question sans réponse ?</h2>
      <p className="mt-2 max-w-[40ch] text-sm leading-relaxed text-(--lp-ink-2)">
        L’équipe Skedul lit chaque demande et vous répond ici, avec le suivi de son avancement.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button asChild size="sm" className={navPrimary}>
          <Link href="/aide/demandes/nouvelle">Créer une demande</Link>
        </Button>
        {signedIn && (
          <Link href="/aide/demandes" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Mes demandes
          </Link>
        )}
      </div>
    </div>
  );
}
