import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type UserRole } from "@/lib/admin-params";

/**
 * The account badges a client component may render (P6 A4: the user search table): no server module here, the
 * suspension arrives as its label (`suspensionLabel` in `@/lib/admin-users`).
 */
export function RoleBadge({ role }: { role: UserRole }) {
  if (role === "admin") {
    return (
      <Badge>
        <ShieldCheck className="size-3" aria-hidden />
        {ROLE_LABELS.admin}
      </Badge>
    );
  }
  return (
    <Badge variant={role === "pro" ? "outline" : "neutral"}>{ROLE_LABELS[role]}</Badge>
  );
}

/** « Actif », or the suspension label in a warning badge. */
export function StatusBadge({ label }: { label: string | null }) {
  if (label === null) {
    return <span className="whitespace-nowrap text-sm text-muted-foreground">Actif</span>;
  }
  return <Badge variant="warning">{label}</Badge>;
}
