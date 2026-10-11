import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LifeBuoy, Plus } from "lucide-react";

import { navPrimary } from "@/components/landing/cta";
import { BackLink } from "@/components/support/back-link";
import { RequestCard } from "@/components/support/request-card";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/session";
import { isOpen } from "@/lib/support";
import { getMyRequests } from "@/server/support-queries";

export const metadata: Metadata = { title: "Mes demandes" };

export default async function MyRequestsPage() {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent("/aide/demandes")}`);
  const requests = await getMyRequests(session.user.id);
  const open = requests.filter(isOpen);
  const done = requests.filter((r) => !isOpen(r));

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-12 sm:px-8">
      <BackLink href="/aide">Centre d’aide</BackLink>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-bold tracking-[-0.03em]">Mes demandes</h1>
        {requests.length > 0 && (
          <Button asChild size="sm" className={navPrimary}>
            <Link href="/aide/demandes/nouvelle">
              <Plus aria-hidden />
              Créer une demande
            </Link>
          </Button>
        )}
      </div>

      {requests.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <LifeBuoy className="size-6" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-xl font-bold tracking-tight">Posez votre première question</h2>
          <p className="mx-auto mt-2 max-w-[42ch] text-sm text-muted-foreground">
            Une question, un problème ou une idée : l’équipe Skedul vous répond ici et vous suivez l’avancement.
          </p>
          <Button asChild size="sm" className={`${navPrimary} mt-6`}>
            <Link href="/aide/demandes/nouvelle">Créer une demande</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {open.length > 0 && (
            <section aria-labelledby="en-cours">
              <h2 id="en-cours" className="text-sm font-semibold text-muted-foreground">
                En cours ({open.length})
              </h2>
              <ul className="mt-3 space-y-3">
                {open.map((r) => (
                  <li key={r.id}>
                    <RequestCard request={r} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {done.length > 0 && (
            <section aria-labelledby="terminees">
              <h2 id="terminees" className="text-sm font-semibold text-muted-foreground">
                Terminées ({done.length})
              </h2>
              <ul className="mt-3 space-y-3">
                {done.map((r) => (
                  <li key={r.id}>
                    <RequestCard request={r} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
