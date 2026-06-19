import { cn, initials } from "@/lib/utils";
import { resolveAvatar, type AvatarInput } from "@/lib/avatar";

/**
 * Polymorphic avatar for public pages: renders a server-generated SVG
 * (DiceBear), an uploaded/pack image, or initials — driven by the pro's
 * stored avatar fields.
 */
export function BrandAvatar({
  name,
  className,
  ...avatar
}: AvatarInput & { name: string; className?: string }) {
  const r = resolveAvatar(avatar);
  const base =
    "grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-card [&>svg]:size-full";

  if (r.mode === "svg") {
    return (
      <span
        className={cn(base, className)}
        role="img"
        aria-label={name}
        dangerouslySetInnerHTML={{ __html: r.svg }}
      />
    );
  }
  if (r.mode === "img") {
    return (
      <span className={cn(base, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.src} alt={name} className="size-full object-cover" />
      </span>
    );
  }
  return (
    <span
      className={cn(base, "bg-accent font-semibold text-accent-foreground", className)}
    >
      {initials(name)}
    </span>
  );
}
