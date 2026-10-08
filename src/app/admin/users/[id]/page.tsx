import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { UserActions } from "@/components/admin/user-actions";
import { RoleBadge, SuspensionBadge } from "@/components/admin/user-badges";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import { ADMIN_TZ, browserName, classifyDevice } from "@/lib/analytics";
import { formatDateShort, formatDateTimeShort } from "@/lib/datetime";
import { isSuspended } from "@/lib/suspension";
import { formatMoney } from "@/lib/utils";
import { getUserDetail } from "@/server/admin-queries";

export const metadata: Metadata = { title: "Utilisateur" };

const DEVICE_LABELS = { mobile: "Mobile", tablet: "Tablette", desktop: "Ordinateur" } as const;
const PROVIDER_LABELS: Record<string, string> = {
  credential: "Mot de passe",
  google: "Google",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const { user: u, pro, providers, sessions, stats, revenue } = detail;
  const suspended = isSuspended(u);

  return (
    <>
      <Link
        href="/admin/users"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Utilisateurs
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={u.name} src={u.image} className="size-12 text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{u.name}</h1>
          <p className="truncate text-sm text-muted-foreground">{u.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <RoleBadge role={u.role} />
          <SuspensionBadge banned={u.banned} banExpires={u.banExpires} />
        </div>
      </div>

      {suspended && u.banReason && (
        <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-warning">
          Motif de la suspension : {u.banReason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Compte</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <Field label="Inscription">{formatDateShort(u.createdAt, ADMIN_TZ)}</Field>
                <Field label="Dernière connexion">
                  {u.lastLoginAt ? formatDateTimeShort(u.lastLoginAt, ADMIN_TZ) : "—"}
                </Field>
                <Field label="E-mail vérifié">{u.emailVerified ? "Oui" : "Non"}</Field>
                <Field label="Connexions">
                  {providers.length
                    ? providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ")
                    : "—"}
                </Field>
              </dl>
            </CardContent>
          </Card>

          {pro && stats && (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle>Page pro</CardTitle>
                <Link
                  href={`/${pro.slug}`}
                  target="_blank"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  /{pro.slug}
                  <ExternalLink className="size-3.5" />
                </Link>
              </CardHeader>
              <CardContent className="space-y-5">
                <dl className="divide-y divide-border">
                  <Field label="Activité">{pro.businessName}</Field>
                  <Field label="Créée le">{formatDateShort(pro.createdAt, ADMIN_TZ)}</Field>
                  <Field label="Fuseau · devise">
                    {pro.timezone} · {pro.currency.toUpperCase()}
                  </Field>
                  <Field label="Google Agenda">
                    {pro.googleCalendarId ? "Connecté" : "Non connecté"}
                  </Field>
                </dl>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: "Prestations", value: stats.eventTypes },
                    { label: "Réservations confirmées", value: stats.bookings },
                    { label: "À venir", value: stats.upcoming },
                    { label: "Clients", value: stats.customers },
                    { label: "Packs vendus", value: stats.packsSold },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-muted/60 p-3">
                      <p className="text-lg font-semibold">
                        {s.value.toLocaleString("fr-FR")}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                  <div className="rounded-xl bg-muted/60 p-3">
                    <p className="text-lg font-semibold">
                      {revenue.length
                        ? revenue.map((r) => formatMoney(r.cents, r.currency)).join(" · ")
                        : formatMoney(0, pro.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">Encaissé (total)</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Sessions actives</CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune session active.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {DEVICE_LABELS[classifyDevice(s.userAgent ?? "")]} ·{" "}
                          {browserName(s.userAgent)}
                          {s.impersonatedBy && (
                            <Badge variant="warning" className="ml-2">
                              En tant que
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground wrap-anywhere">
                          {s.ipAddress || "IP inconnue"} · ouverte le{" "}
                          {formatDateTimeShort(s.createdAt, ADMIN_TZ)}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        expire le {formatDateShort(s.expiresAt, ADMIN_TZ)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <UserActions
            userId={u.id}
            isSelf={u.id === admin.id}
            role={u.role}
            isPro={pro !== null}
            suspended={suspended}
          />
        </div>
      </div>
    </>
  );
}
