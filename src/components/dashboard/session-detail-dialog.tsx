"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SessionCapacityControl } from "@/components/dashboard/session-capacity-control";
import type { PlanningSessionVM } from "@/components/dashboard/planning-calendar";
import { formatSlot } from "@/lib/datetime";
import { cancelBooking, cancelSession, moveAttendee } from "@/server/pro";

export function SessionDetailDialog({
  session,
  tz,
  allSessions,
  onClose,
}: {
  session: PlanningSessionVM;
  tz: string;
  allSessions: PlanningSessionVM[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const booked = session.capacity - session.seatsRemaining;
  const targets = allSessions.filter((s) => s.id !== session.id);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Action impossible.");
      } else {
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <Dialog open onClose={onClose} title={session.eventTitle}>
      <p className="text-sm text-muted-foreground">
        {formatSlot(new Date(session.startAt), new Date(session.endAt), tz)}
      </p>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-xl bg-muted/50 p-3">
        <div className="grid gap-1">
          <p className="text-xs text-muted-foreground">Inscrits</p>
          <p className="flex h-8 items-center text-sm font-semibold tabular-nums">
            {booked} / {session.capacity}
          </p>
        </div>
        <SessionCapacityControl
          key={session.capacity}
          sessionId={session.id}
          capacity={session.capacity}
          booked={booked}
        />
      </div>

      <ul className="mt-4 space-y-3">
        {session.attendees.length === 0 && (
          <li className="text-sm text-muted-foreground">
            Personne d&apos;inscrit pour le moment.
          </li>
        )}
        {session.attendees.map((a) => (
          <li
            key={a.bookingId}
            className="rounded-lg border border-border p-3 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{a.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {a.email}
              </span>
            </div>
            {a.answers.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {a.answers.map((ans, i) => (
                  <li key={i}>
                    {ans.label}: {ans.value}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {targets.length > 0 && (
                <select
                  disabled={pending}
                  defaultValue=""
                  onChange={(e) => {
                    const target = e.target.value;
                    if (target)
                      run(() =>
                        moveAttendee({
                          bookingId: a.bookingId,
                          targetSessionId: target,
                        }),
                      );
                  }}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
                >
                  <option value="" disabled>
                    Déplacer vers…
                  </option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.eventTitle} ·{" "}
                      {new Intl.DateTimeFormat("fr-FR", {
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: tz,
                      }).format(new Date(t.startAt))}
                    </option>
                  ))}
                </select>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(() => cancelBooking(a.bookingId))}
              >
                Désinscrire
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex justify-end border-t border-border pt-4">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => cancelSession(session.id))}
        >
          Annuler la séance
        </Button>
      </div>
    </Dialog>
  );
}
