import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { CalendarPlus, CheckCircle2, Ticket } from "lucide-react";

import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { booking, eventType, pack, packPurchase } from "@/lib/db/schema";
import { formatSlot } from "@/lib/datetime";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar-links";
import { formatMoney } from "@/lib/utils";
import { getPublicProfile } from "@/server/queries";

export const metadata: Metadata = { title: "Merci !" };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string; ref?: string }>;
};

export default async function MerciPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { type, ref } = await searchParams;

  const profile = await getPublicProfile(slug);
  if (!profile) notFound();
  const { pro } = profile;

  let detail: React.ReactNode = null;

  if (type === "booking" && ref) {
    const rows = await db
      .select({ booking, title: eventType.title })
      .from(booking)
      .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
      .where(eq(booking.id, ref))
      .limit(1);
    const b = rows[0];
    if (b) {
      const linkInput = {
        title: b.title,
        description: `Rendez-vous avec ${pro.businessName}`,
        startAt: b.booking.startAt,
        endAt: b.booking.endAt,
      };
      detail = (
        <>
          <p className="font-semibold">{b.title}</p>
          <p className="text-sm text-muted-foreground">
            {formatSlot(b.booking.startAt, b.booking.endAt, pro.timezone)}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarPlus className="size-3.5" />
              Ajouter à mon calendrier :
            </span>
            <Button asChild variant="secondary" size="sm">
              <a
                href={googleCalendarUrl(linkInput)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Agenda
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a
                href={outlookCalendarUrl(linkInput)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Outlook
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/bookings/${b.booking.id}/calendar.ics`}>
                Apple / .ics
              </a>
            </Button>
          </div>
        </>
      );
    }
  } else if (type === "pack" && ref) {
    const rows = await db
      .select({ purchase: packPurchase, name: pack.name })
      .from(packPurchase)
      .innerJoin(pack, eq(pack.id, packPurchase.packId))
      .where(eq(packPurchase.id, ref))
      .limit(1);
    const p = rows[0];
    if (p) {
      detail = (
        <>
          <p className="flex items-center justify-center gap-2 font-semibold">
            <Ticket className="size-4 text-primary" />
            {p.name}
          </p>
          <p className="text-sm text-muted-foreground">
            {p.purchase.creditsTotal} crédits ·{" "}
            {formatMoney(p.purchase.amountPaidCents, p.purchase.currency)}
          </p>
        </>
      );
    }
  }

  return (
    <PublicShell branding={pro} backHref={`/${slug}`}>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 className="size-14 text-success" />
          <h1 className="text-2xl font-bold tracking-tight">
            {type === "pack" ? "Pack activé !" : "Réservation confirmée !"}
          </h1>
          <p className="max-w-sm text-muted-foreground">
            Un email de confirmation vient de vous être envoyé.
          </p>
          {detail && (
            <div className="mt-2 rounded-xl bg-muted px-6 py-4">{detail}</div>
          )}
          <div className="mt-4 flex gap-2">
            <Button asChild variant="secondary">
              <Link href={`/${slug}`}>Retour à la page</Link>
            </Button>
            {type === "pack" && (
              <Button asChild>
                <Link href={`/${slug}`}>Réserver un créneau</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </PublicShell>
  );
}
