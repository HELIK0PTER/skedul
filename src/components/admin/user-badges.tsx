import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type UserRole } from "@/lib/admin-params";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateShort } from "@/lib/datetime";
import { isSuspended } from "@/lib/suspension";

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

export function SuspensionBadge({
  banned,
  banExpires,
}: {
  banned: boolean;
  banExpires: Date | null;
}) {
  if (!isSuspended({ banned, banExpires })) {
    return <span className="text-sm text-muted-foreground">Actif</span>;
  }
  return (
    <Badge variant="warning">
      {banExpires
        ? `Suspendu jusqu'au ${formatDateShort(banExpires, ADMIN_TZ)}`
        : "Suspendu"}
    </Badge>
  );
}
