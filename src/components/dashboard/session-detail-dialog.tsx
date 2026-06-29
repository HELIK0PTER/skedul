"use client";

// Stub — full roster + organise actions implemented in Task 5.
import { Dialog } from "@/components/ui/dialog";
import type { PlanningSessionVM } from "@/components/dashboard/planning-calendar";

export function SessionDetailDialog({
  session,
  onClose,
}: {
  session: PlanningSessionVM;
  tz: string;
  allSessions: PlanningSessionVM[];
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title={session.eventTitle}>
      <p className="text-sm text-muted-foreground">Détail à venir.</p>
    </Dialog>
  );
}
