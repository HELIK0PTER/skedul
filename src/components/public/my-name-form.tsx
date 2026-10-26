"use client";

import { startTransition, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import { FormField } from "@/components/dashboard/form-field";
import { SavedStatus } from "@/components/dashboard/saved-status";
import { useRefusalFocus } from "@/components/dashboard/use-refusal-focus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COPY } from "@/lib/public/messages";
import { plainNameSchema } from "@/lib/public/plain-name";
import { PUBLIC_UNEXPECTED, type PublicResult } from "@/lib/public/result";
import { parseFr } from "@/lib/zod-fr";
import { updateMyNameAction } from "@/server/client";

/** The browser-side twin of the core's rule (src/lib/public/client-actions.ts): the same plain name, the same French texts. */
const nameOnly = z.object({ name: plainNameSchema });

/**
 * « Votre nom » (spec L1384): renames the account and every row linked to it. The field is filled from the name the
 * server rendered; a refused name names the field under its input and takes the focus, a failed call lands in the
 * error box, which sits in an always-mounted alert region (a live region inserted together with its text is not
 * reliably announced) and takes the focus. The « Enregistré » line sits in an always-mounted status region and goes
 * away with the next edit, so a second save is announced again. No router refresh: the action revalidates this page.
 */
export function MyNameForm({ initialName }: { initialName: string }) {
  const { root, errorBox, refused } = useRefusalFocus();
  const [name, setName] = useState(initialName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setSaved(false);
    setError(null);
    const parsed = parseFr(nameOnly, { name });
    if (!parsed.ok) {
      setFieldError(parsed.fieldErrors.name ?? parsed.error);
      refused();
      return;
    }
    setFieldError(null);
    startSave(async () => {
      let res: PublicResult;
      try {
        res = await updateMyNameAction({ name: parsed.data.name });
      } catch {
        res = { ok: false, error: PUBLIC_UNEXPECTED };
      }
      // After an await the updates leave the transition: wrapped again, they commit together with the new props.
      startTransition(() => {
        if (!res.ok) {
          const field = res.fieldErrors?.name ?? null;
          setFieldError(field);
          setError(field === null ? res.error : null);
          refused();
          return;
        }
        setName(parsed.data.name);
        setSaved(true);
      });
    });
  }

  return (
    <form ref={root} method="post" onSubmit={save} noValidate className="space-y-3">
      <FormField label="Votre nom" htmlFor="my-name" error={fieldError}>
        <Input
          id="my-name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setFieldError(null);
            setError(null);
            setSaved(false);
          }}
        />
      </FormField>
      <div role="alert">
        {error && (
          <p
            ref={errorBox}
            tabIndex={-1}
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {saving ? COPY.PENDING_SAVE : "Enregistrer"}
        </Button>
        <SavedStatus saved={saved} message={COPY.SAVED} />
      </div>
    </form>
  );
}
