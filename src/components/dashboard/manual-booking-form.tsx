"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createManualBooking, fetchManualDaySlots } from "@/server/pro";

type Slot = { startISO: string; label: string };

export function ManualBookingButton({
  eventTypes,
}: {
  eventTypes: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loadingSlots, startLoadingSlots] = useTransition();

  const [eventTypeId, setEventTypeId] = useState("");
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [startISO, setStartISO] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEventTypeId("");
    setDay("");
    setSlots([]);
    setStartISO("");
    setName("");
    setEmail("");
    setError(null);
  }

  function loadSlots(nextEventTypeId: string, nextDay: string) {
    setStartISO("");
    setSlots([]);
    if (!nextEventTypeId || !nextDay) return;
    startLoadingSlots(async () => {
      const result = await fetchManualDaySlots(nextEventTypeId, nextDay);
      setSlots(result);
    });
  }

  function submit() {
    setError(null);
    if (!eventTypeId || !startISO || !name.trim() || !email.trim()) {
      setError("Renseignez la prestation, le créneau, le nom et l'e-mail.");
      return;
    }
    startTransition(async () => {
      const res = await createManualBooking({
        eventTypeId,
        startISO,
        customerName: name.trim(),
        customerEmail: email.trim(),
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        router.refresh();
        setOpen(false);
        reset();
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={eventTypes.length === 0}>
        <Plus className="size-4" /> Inscrire
      </Button>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title="Inscrire un client"
      >
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Prestation</span>
            <select
              value={eventTypeId}
              onChange={(e) => {
                setEventTypeId(e.target.value);
                loadSlots(e.target.value, day);
              }}
              className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
            >
              <option value="" disabled>
                Choisir…
              </option>
              {eventTypes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Jour</span>
            <Input
              type="date"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                loadSlots(eventTypeId, e.target.value);
              }}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Créneau</span>
            <select
              value={startISO}
              onChange={(e) => setStartISO(e.target.value)}
              disabled={!eventTypeId || !day || loadingSlots}
              className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm disabled:opacity-50"
            >
              <option value="" disabled>
                {loadingSlots
                  ? "Chargement…"
                  : slots.length === 0
                    ? "Aucun créneau ce jour-là"
                    : "Choisir un créneau…"}
              </option>
              {slots.map((s) => (
                <option key={s.startISO} value={s.startISO}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Nom du client</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">E-mail</span>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Annuler
            </Button>
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending ? "…" : "Inscrire"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
