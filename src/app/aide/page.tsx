import type { Metadata } from "next";

import { FaqBrowser } from "@/components/support/faq-browser";
import { HelpAside } from "@/components/support/help-aside";
import { getSession } from "@/lib/session";
import { isOpen } from "@/lib/support";
import { getMyRequests, getPublishedFaq } from "@/server/support-queries";

export const metadata: Metadata = {
  title: { absolute: "Centre d’aide · Skedul" },
  description: "Les réponses aux questions fréquentes sur Skedul, et un espace pour écrire à l’équipe.",
};

export default async function HelpCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const [{ q }, session, faq] = await Promise.all([searchParams, getSession(), getPublishedFaq()]);
  const openRequests = session
    ? (await getMyRequests(session.user.id)).filter(isOpen).slice(0, 3)
    : [];

  return (
    <FaqBrowser
      categories={faq}
      initialQuery={typeof q === "string" ? q.slice(0, 100) : ""}
      aside={<HelpAside signedIn={session !== null} requests={openRequests} />}
    />
  );
}
