import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, TriangleAlert } from "lucide-react";

import { MerciRefresher } from "@/components/public/merci-refresher";
import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { merciCopy, merciStateOf } from "@/lib/public/merci-view";
import { COPY } from "@/lib/public/messages";
import { notFoundMetadata } from "@/lib/public/page-metadata";
import { resolvePublicPro } from "@/server/public-context";
import { getPurchaseReference } from "@/server/public-queries";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ p?: string | string[] }>;
};

/**
 * The title carries no personal data (« Confirmation · {business} »), the page is never indexed and sends no referrer:
 * the URL carries the purchase reference `p`.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicPro(slug, { includeSuspended: true });
  if (!resolved) return notFoundMetadata();
  return { title: `Confirmation · ${resolved.pro.businessName}`, robots: { index: false }, referrer: "no-referrer" };
}

/**
 * The page a Checkout returns to (spec § 13.5, L1460-1461, contract § 3.22): the real state of THAT purchase and nothing
 * about its customer. A client who paid just before a suspension still sees it. It reads no session and no cookie: the
 * `p` reference, checked against this pro, is the capability. A missing, malformed or foreign `p` is a 404.
 */
export default async function MerciPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { p } = await searchParams;
  const resolved = await resolvePublicPro(slug, { includeSuspended: true });
  if (!resolved) notFound();
  const { pro, branding } = resolved;

  const now = new Date();
  const reference = typeof p === "string" && p !== "" ? await getPurchaseReference(pro.professionalId, p, now) : null;
  if (reference === null) notFound();

  const state = merciStateOf(reference, pro.timezone);
  const { title, body } = merciCopy(state);
  const paid = state.kind === "booked" || state.kind === "paid_shop" || state.kind === "paid_late" || state.kind === "paid_cancelled";
  const waiting = state.kind === "pending" || state.kind === "processing";
  const testLine = paid && !reference.livemode;
  const Icon = paid ? CheckCircle2 : waiting ? Clock : TriangleAlert;

  return (
    <PublicShell branding={branding} backHref={`/${slug}`}>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Icon className={paid ? "size-14 text-success" : "size-14 text-zinc-600"} aria-hidden />
          <div aria-live="polite" className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight wrap-anywhere">{title}</h1>
            <p className="mx-auto max-w-sm text-muted-foreground wrap-anywhere">{body}</p>
          </div>
          {testLine && <p className="text-sm text-zinc-600">{COPY.TEST_PAYMENT_LINE}</p>}
          <MerciRefresher key={state.kind} active={state.kind === "pending"} />
          <div className="mt-4 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button asChild>
              <Link href={`/${slug}/espace`}>Voir mon espace</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/${slug}`}>Retour à la page</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </PublicShell>
  );
}
