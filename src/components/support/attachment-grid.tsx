import { cn } from "@/lib/utils";

/** Thumbnails of a message's screenshots; each opens full size in a new tab. */
export function AttachmentGrid({
  attachments,
  className,
}: {
  attachments: { id: string }[];
  className?: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className={cn("mt-2 flex flex-wrap gap-2", className)}>
      {attachments.map((a, i) => (
        <a
          key={a.id}
          href={`/api/support/attachments/${a.id}`}
          target="_blank"
          rel="noreferrer"
          className="block size-24 overflow-hidden rounded-xl border border-border bg-muted transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked route */}
          <img
            src={`/api/support/attachments/${a.id}`}
            alt={`Capture d’écran ${i + 1}`}
            loading="lazy"
            className="size-full object-cover"
          />
        </a>
      ))}
    </div>
  );
}
