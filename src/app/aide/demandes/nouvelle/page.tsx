import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BackLink } from "@/components/support/back-link";
import { NewRequestForm } from "@/components/support/new-request-form";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { MAX_SUBJECT, parseSupportType } from "@/lib/support";
import { getPublishedFaq } from "@/server/support-queries";

export const metadata: Metadata = { title: "Nouvelle demande" };

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ sujet?: string | string[]; type?: string | string[] }>;
}) {
  const params = await searchParams;
  const subject = typeof params.sujet === "string" ? params.sujet.slice(0, MAX_SUBJECT) : "";
  const type = parseSupportType(typeof params.type === "string" ? params.type : undefined);

  const session = await getSession();
  if (!session) {
    const back = `/aide/demandes/nouvelle${subject ? `?sujet=${encodeURIComponent(subject)}` : ""}`;
    redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  }

  const faq = await getPublishedFaq();
  const articles = faq.flatMap((c) =>
    c.articles.map((a) => ({ id: a.id, question: a.question, answer: a.answer })),
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-24 pt-12 sm:px-8">
      <BackLink href="/aide/demandes">Mes demandes</BackLink>
      <h1 className="mt-6 font-display text-4xl font-bold tracking-[-0.03em]">Nouvelle demande</h1>
      <p className="mt-3 max-w-[52ch] text-(--lp-ink-2)">
        L’équipe Skedul lit chaque demande et vous répond dans son fil. Vous suivez son avancement étape par étape.
      </p>
      {session.session.impersonatedBy ? (
        <p className="mt-8 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Vous consultez ce compte en tant qu’admin : la création de demande est désactivée.
        </p>
      ) : (
        <NewRequestForm
          articles={articles}
          initialSubject={subject}
          initialType={type}
          imagesEnabled={env.SUPPORT_BLOB_ENABLED}
        />
      )}
    </div>
  );
}
