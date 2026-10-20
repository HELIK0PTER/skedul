import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";

import { ClientBookings } from "@/components/dashboard/client-bookings";
import { ClientHeader } from "@/components/dashboard/client-header";
import { ClientPurchases } from "@/components/dashboard/client-purchases";
import { ClientWallet } from "@/components/dashboard/client-wallet";
import { LedgerList } from "@/components/dashboard/ledger-list";
import { OneTimeNotice } from "@/components/dashboard/one-time-notice";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { todayKey } from "@/lib/civil-date";
import { getClientRecordPage } from "@/server/client-queries";
import { requireProContext } from "@/server/pro-context";

export const metadata: Metadata = { title: "Fiche client" };

const EXISTING_RECORD_NOTICE = "Cet email avait déjà une fiche : elle porte maintenant le nom saisi.";

export default async function ClientRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ existant?: string | string[] }>;
}) {
  const ctx = await requireProContext();
  const { id } = await params;
  // « Nouveau client » opens the record of an e-mail that already had one with ?existant=1 (a repeated param is ignored);
  // OneTimeNotice then takes the param out of the URL, so that a reload does not bring the notice back.
  const { existant } = await searchParams;
  const record = await getClientRecordPage(ctx.professionalId, id);
  if (!record) notFound();
  const today = todayKey(new Date(), ctx.timezone);
  const { customer } = record;

  return (
    <>
      <PageHeader
        title={customer.name}
        description={customer.email}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/clients">
              <ArrowLeft />
              Tous les clients
            </Link>
          </Button>
        }
      />

      <OneTimeNotice param="existant" active={existant === "1"}>
        <p role="status" className="mb-6 flex items-start gap-2 rounded-xl bg-primary-muted px-4 py-3 text-sm text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
          <span>{EXISTING_RECORD_NOTICE}</span>
        </p>
      </OneTimeNotice>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:grid-rows-[auto_auto_auto_1fr] lg:items-start">
        <div className="lg:col-start-3 lg:row-start-1">
          <ClientHeader
            customer={{
              id: customer.id,
              name: customer.name,
              email: customer.email,
              phone: customer.phone,
              linkedAccount: customer.linkedAccount,
            }}
          />
        </div>
        <div className="lg:col-span-2 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <ClientWallet
            customerId={customer.id}
            groups={record.wallet}
            typeOptions={record.typeOptions}
            todayKey={today}
          />
        </div>
        <div className="lg:col-span-2 lg:col-start-1 lg:row-start-3">
          <ClientBookings
            customerName={customer.name}
            upcoming={record.bookings.upcoming}
            past={record.bookings.past}
          />
        </div>
        <div className="lg:col-start-3 lg:row-span-3 lg:row-start-2">
          <ClientPurchases purchases={record.purchases} tz={ctx.timezone} />
        </div>
        <div className="lg:col-span-2 lg:col-start-1 lg:row-start-4">
          <LedgerList lines={record.history} />
        </div>
      </div>
    </>
  );
}
