import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";

/**
 * The empty state of a list or a page: icon, title, one line of help, and the action that fills it.
 * `bare` drops the bordered card, for an empty state that sits inside a card of its own.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  bare,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  bare?: boolean;
}) {
  const content = (
    <>
      <Icon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </>
  );
  if (bare) return <div className="flex flex-col items-center gap-3 px-6 py-6 text-center">{content}</div>;
  return <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">{content}</Card>;
}
