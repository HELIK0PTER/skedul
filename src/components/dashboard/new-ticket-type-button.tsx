"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { callOrFail } from "@/lib/pro-messages";
import { DEFAULT_COLOR } from "@/lib/tickets-vocab";
import { createTicketTypeAction } from "@/server/pro-catalog";

const NAME_HELP = "Par exemple « Cours collectif ».";

/** Opens a dialog (name, colour) and sends the pro to the new type's page, where offers and options are set. */
export function NewTicketTypeButton({ label = "Nouveau type de ticket" }: { label?: string }) {
  const router = useRouter();
  const uid = useId();
  const nameId = `${uid}-name`;
  const colorId = `${uid}-color`;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The action reports one message: when it concerns the name it sits under the field, otherwise above the buttons.
  const nameError = error !== null && error.startsWith("Nom :") ? error : null;
  const formError = nameError === null ? error : null;

  function openDialog() {
    setName("");
    setColor(DEFAULT_COLOR);
    setError(null);
    setOpen(true);
  }

  function close() {
    if (!pending) setOpen(false);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await callOrFail(() => createTicketTypeAction({ name, color }));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/dashboard/tickets/${res.ticketTypeId}`);
    });
  }

  return (
    <>
      <Button onClick={openDialog}>
        <Plus />
        {label}
      </Button>
      <Dialog open={open} onClose={close} title="Nouveau type de ticket">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {/* FormField wires aria-describedby (helper, then error) and aria-invalid into the input. */}
          <FormField label="Nom" htmlFor={nameId} help={NAME_HELP} error={nameError}>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoComplete="off"
              autoFocus
            />
          </FormField>
          <FormField label="Couleur" htmlFor={colorId}>
            <input
              id={colorId}
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-16 cursor-pointer rounded-xl border border-input bg-card p-1"
            />
          </FormField>
          <FormError message={formError} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              Retour
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Créer
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
