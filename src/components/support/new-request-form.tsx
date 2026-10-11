"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";

import { ctaPrimary } from "@/components/landing/cta";
import { ImageAttachInput, type PickedImage } from "@/components/support/image-attach-input";
import { TYPE_ICONS } from "@/components/support/support-type";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_BODY,
  MAX_SUBJECT,
  SUPPORT_TYPES,
  TYPE_HINTS,
  TYPE_LABELS,
  matchArticles,
  type SupportType,
} from "@/lib/support";
import { cn } from "@/lib/utils";
import { createSupportRequest } from "@/server/support";

type Article = { id: string; question: string; answer: string };

/** Step 1 picks the type; step 2 (revealed) asks for the subject, details and screenshots. */
export function NewRequestForm({
  articles,
  initialSubject,
  initialType,
  imagesEnabled,
}: {
  articles: Article[];
  initialSubject: string;
  initialType: SupportType | null;
  imagesEnabled: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<SupportType | null>(initialType);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const suggestions = useMemo(() => matchArticles(articles, subject).slice(0, 3), [articles, subject]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!type) {
      setError("Choisissez le type de demande.");
      return;
    }
    const data = new FormData();
    data.set("type", type);
    data.set("subject", subject);
    data.set("body", body);
    images.forEach((i) => data.append("images", i.file));
    setError(null);
    startTransition(async () => {
      try {
        const res = await createSupportRequest(data);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        images.forEach((i) => URL.revokeObjectURL(i.url));
        // push only (Next 16 router): the detail page is fetched fresh
        router.push(`/aide/demandes/${res.id}${res.warning ? "?images=partiel" : ""}`);
      } catch {
        setError("Connexion perdue. Réessayez.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-8">
      <fieldset>
        <legend className="font-display text-lg font-bold tracking-tight">De quoi s’agit-il ?</legend>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SUPPORT_TYPES.map((t) => {
            const Icon = TYPE_ICONS[t];
            return (
              <label
                key={t}
                className="group flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-(--shadow-card) transition-colors hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="radio"
                  name="type"
                  value={t}
                  checked={type === t}
                  onChange={() => setType(t)}
                  className="sr-only"
                />
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-has-[:checked]:bg-primary group-has-[:checked]:text-primary-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold">{TYPE_LABELS[t]}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{TYPE_HINTS[t]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {type && (
        <div className="space-y-6 motion-safe:animate-[fade-up_300ms_cubic-bezier(0.16,1,0.3,1)_both]">
          <div className="space-y-2">
            <Label htmlFor="subject">Sujet</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={MAX_SUBJECT}
              placeholder={type === "feature" ? "Exporter mes réservations en CSV" : "Je ne vois pas mes créneaux du samedi"}
              required
            />
            {suggestions.length > 0 && (
              <div className="rounded-2xl bg-accent px-4 py-3">
                <p className="text-sm font-medium text-accent-foreground">Ces articles répondent peut-être à votre question :</p>
                <ul className="mt-2 space-y-1.5">
                  {suggestions.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/aide#a-${a.id}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                      >
                        {a.question}
                        <ArrowUpRight className="size-3.5" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Description</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MAX_BODY}
              rows={7}
              required
            />
            <p className="text-xs text-muted-foreground">
              Plus vous donnez de détails (page concernée, étapes, message affiché), plus vite l’équipe peut vous aider.
            </p>
          </div>

          {imagesEnabled && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Captures d’écran</p>
              <ImageAttachInput images={images} onChange={setImages} disabled={pending} />
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {type && (
        <Button type="submit" className={cn(ctaPrimary, "w-full sm:w-auto")} disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Envoyer la demande
        </Button>
      )}
    </form>
  );
}
