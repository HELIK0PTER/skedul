"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Pencil } from "lucide-react";

import { updateSlug } from "@/server/pro";
import { SLUG_MAX_LENGTH, typingSlug } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const HINT =
  "Lettres, chiffres et tirets. L’ancienne adresse ne fonctionnera plus : pensez à mettre à jour les liens déjà partagés.";

/** "Adresse : https://…/slug" with an inline editor for the last segment. */
export function SlugEditor({ appUrl, slug }: { appUrl: string; slug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(slug);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slug);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing || !input.current) return;
    const el = input.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  function open() {
    setDraft(current);
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updateSlug({ slug: draft });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(res.slug !== current);
      setCurrent(res.slug);
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>Adresse :</span>
        <span className="break-all font-mono text-foreground">
          {appUrl}/{current}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={open}
        >
          <Pencil /> Modifier
        </Button>
        {saved && <span className="text-success">Adresse mise à jour ✓</span>}
      </div>
    );
  }

  const unchanged = draft.replace(/-+$/, "") === current;

  return (
    <form onSubmit={onSubmit} className="space-y-2 pt-2">
      <Label htmlFor="slug">Adresse de votre page</Label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div
          className={cn(
            "flex h-10 min-w-0 items-center rounded-xl border bg-card shadow-sm transition-colors focus-within:ring-2 sm:flex-1",
            error
              ? "border-destructive focus-within:ring-destructive/25"
              : "border-input focus-within:border-ring focus-within:ring-ring",
          )}
        >
          <span className="shrink-0 select-none pl-3 font-mono text-sm text-muted-foreground">
            {appUrl.replace(/^https?:\/\//, "")}/
          </span>
          <input
            ref={input}
            id="slug"
            name="slug"
            value={draft}
            onChange={(e) => {
              setDraft(typingSlug(e.target.value));
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
            }}
            maxLength={SLUG_MAX_LENGTH}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby="slug-help"
            className="h-full min-w-0 flex-1 bg-transparent pr-3 font-mono text-sm text-foreground outline-none"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || unchanged || !draft}>
            {pending && <Loader2 className="animate-spin" />}
            Enregistrer
          </Button>
          <Button type="button" variant="ghost" onClick={cancel} disabled={pending}>
            Annuler
          </Button>
        </div>
      </div>
      <div id="slug-help" className="space-y-1">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{HINT}</p>
      </div>
    </form>
  );
}
