import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Mail, UserRound } from "lucide-react";

import { SupportAdminPanel } from "@/components/admin/support-admin-panel";
import { BackLink } from "@/components/support/back-link";
import { MessageComposer } from "@/components/support/message-composer";
import { MessageThread } from "@/components/support/message-thread";
import { StageProgress } from "@/components/support/stage-progress";
import { SupportTypeChip } from "@/components/support/support-type";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateTimeShort } from "@/lib/datetime";
import { env } from "@/lib/env";
import { stageReachedAt } from "@/lib/support";
import { adminReply } from "@/server/support-admin";
import { markReadByAdmin } from "@/server/support-core";
import { getSupportRequestForAdmin } from "@/server/support-queries";

export const metadata: Metadata = { title: "Demande de support" };

export default async function AdminSupportRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const data = await getSupportRequestForAdmin(id);
  if (!data) notFound();
  const { request, author, thread } = data;
  if (request.unreadByAdmin) {
    await markReadByAdmin(id).catch((err) => console.error("[admin] support mark read failed", err));
  }

  return (
    <>
      <BackLink href="/admin/support">Support</BackLink>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <SupportTypeChip type={request.type} />
        <span className="tabular-nums">#{request.number}</span>
        <span>ouverte le {formatDateTimeShort(request.createdAt, ADMIN_TZ)}</span>
      </div>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-balance">{request.subject}</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-8">
          <StageProgress
            track={request.track}
            stage={request.stage}
            resolution={request.resolution}
            reachedAt={stageReachedAt(request.createdAt, thread)}
            eta={request.eta}
          />
          <MessageThread thread={thread} viewer="admin" />
          <MessageComposer
            requestId={request.id}
            action={adminReply}
            imagesEnabled={env.SUPPORT_BLOB_ENABLED}
            placeholder={`Répondre à ${author.name}`}
          />
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="font-semibold">{author.name}</p>
              <a
                href={`mailto:${author.email}`}
                className="flex items-center gap-2 break-all text-sm text-muted-foreground hover:text-foreground"
              >
                <Mail className="size-4 shrink-0" aria-hidden />
                {author.email}
              </a>
              {author.proSlug && (
                <a
                  href={`/${author.proSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-4 shrink-0" aria-hidden />
                  {author.businessName ?? author.proSlug}
                </a>
              )}
              <Link
                href={`/admin/users/${author.id}`}
                className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                <UserRound className="size-4 shrink-0" aria-hidden />
                Voir la fiche
              </Link>
            </CardContent>
          </Card>
          <SupportAdminPanel
            request={{
              id: request.id,
              track: request.track,
              stage: request.stage,
              resolution: request.resolution,
              eta: request.eta,
            }}
          />
        </aside>
      </div>
    </>
  );
}
