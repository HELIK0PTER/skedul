"use client";

import { useId, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateTicketTypeAction } from "@/server/pro-catalog";

const INFO_FIELD_PREFIXES = ["Nom :", "Description :", "Couleur :"] as const;

/** « Informations »: name, description and colour of the type. A failed save keeps the form filled. */
export function TicketTypeInfoForm({
  ticketTypeId,
  initial,
}: {
  ticketTypeId: string;
  initial: { name: string; description: string; color: string };
}) {
  const uid = useId();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [color, setColor] = useState(initial.color);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const under = (prefix: string): string | null => (error !== null && error.startsWith(prefix) ? error : null);
  const general = error !== null && !INFO_FIELD_PREFIXES.some((p) => error.startsWith(p)) ? error : null;

  function edit<T>(set: (value: T) => void, value: T) {
    set(value);
    setSaved(false);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const trimmed = description.trim();
      const res = await updateTicketTypeAction({
        ticketTypeId,
        patch: { name, description: trimmed === "" ? null : trimmed, color },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormField label="Nom" htmlFor={`${uid}-name`} error={under("Nom :")}>
        <Input
          id={`${uid}-name`}
          value={name}
          onChange={(e) => edit(setName, e.target.value)}
          maxLength={80}
          autoComplete="off"
        />
      </FormField>
      <FormField label="Description" htmlFor={`${uid}-description`} optional error={under("Description :")}>
        <Textarea
          id={`${uid}-description`}
          value={description}
          onChange={(e) => edit(setDescription, e.target.value)}
          maxLength={2000}
          rows={3}
        />
      </FormField>
      <FormField label="Couleur" htmlFor={`${uid}-color`} error={under("Couleur :")}>
        <input
          id={`${uid}-color`}
          type="color"
          value={color}
          onChange={(e) => edit(setColor, e.target.value)}
          className="block h-10 w-16 cursor-pointer rounded-xl border border-input bg-card p-1"
        />
      </FormField>
      <FormError message={general} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Enregistrer
        </Button>
        {saved && (
          <span role="status" className="flex items-center gap-1.5 text-sm text-green-700">
            <Check className="size-4" />
            Enregistré
          </span>
        )}
      </div>
    </form>
  );
}
