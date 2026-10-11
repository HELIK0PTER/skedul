"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";

import { FaqAnswer } from "@/components/support/faq-answer";
import { HELP_ICON_COMPONENTS, HELP_ICON_LABELS } from "@/components/support/help-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HELP_ICONS, MAX_BODY, type HelpIcon } from "@/lib/support";
import {
  deleteHelpArticle,
  deleteHelpCategory,
  moveHelpArticle,
  moveHelpCategory,
  saveHelpArticle,
  saveHelpCategory,
  setHelpArticlePublished,
  type AdminSupportResult,
} from "@/server/support-admin";
import type { FaqArticle, FaqCategory } from "@/server/support-queries";

type Editing =
  | { kind: "category"; category: FaqCategory | null }
  | { kind: "article"; categoryId: string; article: FaqArticle | null };

export function FaqEditor({ categories }: { categories: FaqCategory[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const articleCount = categories.reduce((n, c) => n + c.articles.length, 0);
  const publishedCount = categories.reduce((n, c) => n + c.articles.filter((a) => a.published).length, 0);

  function run(action: () => Promise<AdminSupportResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onDone?.();
        router.refresh();
      } catch {
        setError("Connexion perdue. Réessayez.");
      }
    });
  }

  function open(next: Editing) {
    setError(null);
    setEditing(next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {categories.length} rubrique{categories.length > 1 ? "s" : ""}, {articleCount} article
          {articleCount > 1 ? "s" : ""} dont {publishedCount} publié{publishedCount > 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={() => open({ kind: "category", category: null })}>
          <Plus />
          Nouvelle rubrique
        </Button>
      </div>

      {error && !editing && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {categories.length === 0 && (
        <Card className="px-6 py-12 text-center text-sm text-muted-foreground">
          Aucune rubrique. Créez-en une pour commencer la FAQ.
        </Card>
      )}

      {categories.map((c, ci) => {
        const Icon = HELP_ICON_COMPONENTS[c.icon];
        return (
          <Card key={c.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{c.title}</p>
                <p className="text-xs text-muted-foreground">/aide#rubrique-{c.slug}</p>
              </div>
              <div className="flex gap-1">
                <IconButton label="Monter la rubrique" disabled={pending || ci === 0} onClick={() => run(() => moveHelpCategory({ id: c.id, direction: "up" }))}>
                  <ArrowUp />
                </IconButton>
                <IconButton label="Descendre la rubrique" disabled={pending || ci === categories.length - 1} onClick={() => run(() => moveHelpCategory({ id: c.id, direction: "down" }))}>
                  <ArrowDown />
                </IconButton>
                <IconButton label="Modifier la rubrique" disabled={pending} onClick={() => open({ kind: "category", category: c })}>
                  <Pencil />
                </IconButton>
                <IconButton
                  label="Supprimer la rubrique"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Supprimer la rubrique « ${c.title} » ?`)) {
                      run(() => deleteHelpCategory({ id: c.id }));
                    }
                  }}
                >
                  <Trash2 />
                </IconButton>
              </div>
            </div>

            {c.articles.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Aucun article dans cette rubrique.</p>
            ) : (
              <ul className="divide-y divide-border">
                {c.articles.map((a, ai) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <p className="min-w-0 flex-1 text-sm font-medium">{a.question}</p>
                    <Badge variant={a.published ? "success" : "neutral"}>{a.published ? "Publié" : "Brouillon"}</Badge>
                    <div className="flex gap-1">
                      <IconButton label="Monter l’article" disabled={pending || ai === 0} onClick={() => run(() => moveHelpArticle({ id: a.id, direction: "up" }))}>
                        <ArrowUp />
                      </IconButton>
                      <IconButton label="Descendre l’article" disabled={pending || ai === c.articles.length - 1} onClick={() => run(() => moveHelpArticle({ id: a.id, direction: "down" }))}>
                        <ArrowDown />
                      </IconButton>
                      <IconButton
                        label={a.published ? "Dépublier" : "Publier"}
                        disabled={pending}
                        onClick={() => run(() => setHelpArticlePublished({ id: a.id, published: !a.published }))}
                      >
                        {a.published ? <EyeOff /> : <Eye />}
                      </IconButton>
                      <IconButton label="Modifier l’article" disabled={pending} onClick={() => open({ kind: "article", categoryId: c.id, article: a })}>
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label="Supprimer l’article"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm("Supprimer cet article ?")) run(() => deleteHelpArticle({ id: a.id }));
                        }}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-border px-5 py-3">
              <Button variant="ghost" size="sm" onClick={() => open({ kind: "article", categoryId: c.id, article: null })}>
                <Plus />
                Ajouter un article
              </Button>
            </div>
          </Card>
        );
      })}

      {editing?.kind === "category" && (
        <CategoryDialog
          category={editing.category}
          pending={pending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            run(() => saveHelpCategory({ id: editing.category?.id, ...input }), () => setEditing(null))
          }
        />
      )}
      {editing?.kind === "article" && (
        <ArticleDialog
          categories={categories}
          categoryId={editing.categoryId}
          article={editing.article}
          pending={pending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            run(() => saveHelpArticle({ id: editing.article?.id, ...input }), () => setEditing(null))
          }
        />
      )}
    </div>
  );
}

function IconButton({
  label,
  children,
  ...props
}: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={label} title={label} {...props}>
      {children}
    </Button>
  );
}

function CategoryDialog({
  category,
  pending,
  error,
  onClose,
  onSave,
}: {
  category: FaqCategory | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: { title: string; icon: HelpIcon }) => void;
}) {
  const [title, setTitle] = useState(category?.title ?? "");
  const [icon, setIcon] = useState<HelpIcon>(category?.icon ?? "help");
  return (
    <Dialog open onClose={onClose} title={category ? "Modifier la rubrique" : "Nouvelle rubrique"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ title, icon });
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="category-title">Titre</Label>
          <Input id="category-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Icône</legend>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {HELP_ICONS.map((name) => {
              const Icon = HELP_ICON_COMPONENTS[name];
              return (
                <label
                  key={name}
                  className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-border p-2 text-xs text-muted-foreground transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    name="icon"
                    value={name}
                    checked={icon === name}
                    onChange={() => setIcon(name)}
                    className="sr-only"
                  />
                  <Icon className="size-5" aria-hidden />
                  {HELP_ICON_LABELS[name]}
                </label>
              );
            })}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ArticleDialog({
  categories,
  categoryId,
  article,
  pending,
  error,
  onClose,
  onSave,
}: {
  categories: FaqCategory[];
  categoryId: string;
  article: FaqArticle | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: { categoryId: string; question: string; answer: string; published: boolean }) => void;
}) {
  const [category, setCategory] = useState(categoryId);
  const [question, setQuestion] = useState(article?.question ?? "");
  const [answer, setAnswer] = useState(article?.answer ?? "");
  const [published, setPublished] = useState(article?.published ?? true);
  return (
    <Dialog open onClose={onClose} title={article ? "Modifier l’article" : "Nouvel article"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ categoryId: category, question, answer, published });
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="article-category">Rubrique</Label>
          <Select id="article-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="article-question">Question</Label>
          <Input id="article-question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="article-answer">Réponse</Label>
          <Textarea
            id="article-answer"
            rows={8}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={MAX_BODY}
            required
          />
          <p className="text-xs text-muted-foreground">
            Une ligne vide crée un paragraphe, « - » en début de ligne crée une liste, les liens https:// et /chemin
            deviennent cliquables.
          </p>
        </div>
        {answer.trim() && (
          <div className="rounded-xl border border-dashed border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Aperçu</p>
            <FaqAnswer text={answer} />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="size-4 accent-(--color-primary)"
          />
          Publié sur le centre d’aide
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
