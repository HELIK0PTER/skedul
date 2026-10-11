import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BackLink } from "@/components/support/back-link";
import { MessageComposer } from "@/components/support/message-composer";
import { MessageThread } from "@/components/support/message-thread";
import { StageProgress } from "@/components/support/stage-progress";
import { SupportTypeChip } from "@/components/support/support-type";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateShort } from "@/lib/datetime";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { canUserReply, stageReachedAt } from "@/lib/support";
import { replyToSupportRequest } from "@/server/support";
import { markReadByUser } from "@/server/support-core";
import { getMyRequest } from "@/server/support-queries";

export const metadata: Metadata = { title: "Demande" };

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ images?: string | string[] }>;
}) {
  const [{ id }, { images }] = await Promise.all([params, searchParams]);
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/aide/demandes/${id}`)}`);
  const data = await getMyRequest(session.user.id, id);
  if (!data) notFound();
  const { request, thread } = data;
  const impersonating = Boolean(session.session.impersonatedBy);
  // an admin looking through the account must not clear the user's "new reply" flag
  if (request.unreadByUser && !impersonating) {
    await markReadByUser(session.user.id, id).catch((err) =>
      console.error("[support] mark read by user failed", err),
    );
  }

  const disabledReason = impersonating
    ? "Vous consultez ce compte en tant qu’admin : la réponse est désactivée."
    : !canUserReply(request)
      ? "Cette demande est fermée. Créez une nouvelle demande si besoin."
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-12 sm:px-8">
      <BackLink href="/aide/demandes">Mes demandes</BackLink>
      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <SupportTypeChip type={request.type} />
          <span>
            #{request.number}, ouverte le {formatDateShort(request.createdAt, ADMIN_TZ)}
          </span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] text-balance sm:text-4xl">
          {request.subject}
        </h1>
      </header>

      {images === "partiel" && (
        <p role="status" className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-warning">
          Votre demande est envoyée, mais une image n’a pas pu être jointe. Vous pouvez la renvoyer dans une réponse.
        </p>
      )}

      <StageProgress
        className="mt-6"
        track={request.track}
        stage={request.stage}
        resolution={request.resolution}
        reachedAt={stageReachedAt(request.createdAt, thread)}
        eta={request.eta}
      />

      <h2 className="sr-only">Conversation</h2>
      <MessageThread className="mt-10" thread={thread} viewer="user" />
      <MessageComposer
        className="mt-8"
        requestId={request.id}
        action={replyToSupportRequest}
        imagesEnabled={env.SUPPORT_BLOB_ENABLED}
        disabledReason={disabledReason}
      />
    </div>
  );
}
