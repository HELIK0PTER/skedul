import { StatusBadge } from "@/components/admin/badges";
import { suspensionLabel } from "@/lib/admin-users";

export { RoleBadge } from "@/components/admin/badges";

/** The suspension of an account read from its ban fields (server components only: it reads `@/lib/suspension`). */
export function SuspensionBadge({
  banned,
  banExpires,
}: {
  banned: boolean;
  banExpires: Date | null;
}) {
  return <StatusBadge label={suspensionLabel({ banned, banExpires })} />;
}
