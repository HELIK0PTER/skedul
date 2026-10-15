import { Badge } from "@/components/ui/badge";

/** A ticket type: its colour dot and name, an optional count and the « Archivé » badge. */
export function TypeChip({
  name,
  color,
  archived,
  count,
}: {
  name: string;
  color: string;
  archived?: boolean;
  count?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-medium">{name}</span>
      {count !== undefined && <span className="text-muted-foreground">{`· ${count}`}</span>}
      {archived && <Badge variant="neutral">Archivé</Badge>}
    </span>
  );
}
