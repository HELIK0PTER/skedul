"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, Clock, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { deleteEventType, saveEventType, saveQuestion, deleteQuestion } from "@/server/pro";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/utils";
import {
  WeeklyHoursEditor,
  byDayFromRules,
  rulesFromByDay,
  type ByDay,
  type Rule,
} from "./weekly-hours-editor";

export interface EventTypeItem {
  id: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  capacity?: number;
  color: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  isActive: boolean;
  /** the event type's own availability rules; empty = inherits the global schedule */
  availability: Rule[];
}

export interface Question {
  id: string;
  label: string;
  type: "text" | "choice" | "boolean";
  options: string[] | null;
  required: boolean;
  position: number;
}

const COLORS = ["#6d5cf6", "#0ea5e9", "#16a34a", "#f59e0b", "#ec4899", "#ef4444"];

export function EventTypesManager({
  items,
  questionsByEventType = {},
}: {
  items: EventTypeItem[];
  questionsByEventType?: Record<string, Question[]>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(
    e: React.FormEvent<HTMLFormElement>,
    id: string | undefined,
    availability: { customized: boolean; rules: Rule[] },
    capacity: number,
  ) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    startTransition(async () => {
      await saveEventType({
        id,
        title: String(f.get("title")),
        description: String(f.get("description") ?? ""),
        durationMinutes: Number(f.get("durationMinutes")),
        priceCents: Math.round(Number(f.get("price")) * 100),
        capacity,
        color: String(f.get("color")),
        bufferBeforeMinutes: Number(f.get("bufferBefore") ?? 0),
        bufferAfterMinutes: Number(f.get("bufferAfter") ?? 0),
        isActive: f.get("isActive") === "on",
        availability,
      });
      setEditing(null);
      router.refresh();
    });
  }

  function onDelete(id: string) {
    if (!confirm("Supprimer cette prestation ?")) return;
    startTransition(async () => {
      await deleteEventType(id);
      router.refresh();
    });
  }

  function onDeleteQuestion(id: string) {
    if (!confirm("Supprimer cette question ?")) return;
    startTransition(async () => {
      await deleteQuestion(id);
      router.refresh();
    });
  }

  function onSaveQuestion(eventTypeId: string, data: {
    label: string;
    type: "text" | "choice" | "boolean";
    optionsCsv: string;
    required: boolean;
    position: number;
  }) {
    startTransition(async () => {
      await saveQuestion({
        eventTypeId,
        label: data.label,
        type: data.type,
        options:
          data.type === "choice"
            ? data.optionsCsv.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
        required: data.required,
        position: data.position,
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {items.map((item) =>
        editing === item.id ? (
          <EventTypeForm
            key={item.id}
            item={item}
            pending={pending}
            questions={questionsByEventType[item.id] ?? []}
            onCancel={() => setEditing(null)}
            onSubmit={(e, availability, capacity) => onSubmit(e, item.id, availability, capacity)}
            onDeleteQuestion={onDeleteQuestion}
            onSaveQuestion={(data) => onSaveQuestion(item.id, data)}
          />
        ) : (
          <Card key={item.id}>
            <CardContent className="flex flex-wrap items-center gap-4 p-5">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{item.title}</p>
                  {!item.isActive && <Badge variant="neutral">Masquée</Badge>}
                  {item.availability.length > 0 && (
                    <Badge variant="neutral">
                      <CalendarClock className="size-3.5" />
                      Horaires perso
                    </Badge>
                  )}
                </div>
                <p className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" />
                    {item.durationMinutes} min
                  </span>
                  <span>
                    {item.priceCents > 0
                      ? formatMoney(item.priceCents)
                      : "Gratuit"}
                  </span>
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditing(item.id)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ),
      )}

      {editing === "new" ? (
        <EventTypeForm
          pending={pending}
          questions={[]}
          onCancel={() => setEditing(null)}
          onSubmit={(e, availability, capacity) => onSubmit(e, undefined, availability, capacity)}
          onDeleteQuestion={onDeleteQuestion}
          onSaveQuestion={() => {}}
        />
      ) : (
        <Button variant="secondary" onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          Nouvelle prestation
        </Button>
      )}
    </div>
  );
}

function EventTypeForm({
  item,
  pending,
  questions,
  onCancel,
  onSubmit,
  onDeleteQuestion,
  onSaveQuestion,
}: {
  item?: EventTypeItem;
  pending: boolean;
  questions: Question[];
  onCancel: () => void;
  onSubmit: (
    e: React.FormEvent<HTMLFormElement>,
    availability: { customized: boolean; rules: Rule[] },
    capacity: number,
  ) => void;
  onDeleteQuestion: (id: string) => void;
  onSaveQuestion: (data: {
    label: string;
    type: "text" | "choice" | "boolean";
    optionsCsv: string;
    required: boolean;
    position: number;
  }) => void;
}) {
  const [custom, setCustom] = useState((item?.availability.length ?? 0) > 0);
  const [byDay, setByDay] = useState<ByDay>(() =>
    byDayFromRules(item?.availability ?? []),
  );
  const [capacity, setCapacity] = useState(item?.capacity ?? 1);

  // Add-question form state
  const [qLabel, setQLabel] = useState("");
  const [qType, setQType] = useState<"text" | "choice" | "boolean">("text");
  const [qOptions, setQOptions] = useState("");
  const [qRequired, setQRequired] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    onSubmit(e, { customized: custom, rules: rulesFromByDay(byDay) }, capacity);
  }

  function handleAddQuestion(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!qLabel.trim()) return;
    onSaveQuestion({
      label: qLabel.trim(),
      type: qType,
      optionsCsv: qOptions,
      required: qRequired,
      position: questions.length,
    });
    setQLabel("");
    setQType("text");
    setQOptions("");
    setQRequired(false);
  }

  return (
    <Card className="border-primary/40">
      <CardContent className="p-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Titre</Label>
            <Input
              id="title"
              name="title"
              defaultValue={item?.title}
              placeholder="Séance de coaching"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={item?.description ?? ""}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="durationMinutes">Durée (min)</Label>
              <Input
                id="durationMinutes"
                name="durationMinutes"
                type="number"
                min={5}
                step={5}
                defaultValue={item?.durationMinutes ?? 30}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price">Prix (€)</Label>
              <Input
                id="price"
                name="price"
                type="number"
                min={0}
                step="0.01"
                defaultValue={item ? item.priceCents / 100 : 0}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="capacity">Capacité</Label>
            <Input
              id="capacity"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              1 = rendez-vous individuel ; ≥ 2 = cours de groupe.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bufferBefore">Marge avant (min)</Label>
              <Input
                id="bufferBefore"
                name="bufferBefore"
                type="number"
                min={0}
                step={5}
                defaultValue={item?.bufferBeforeMinutes ?? 0}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bufferAfter">Marge après (min)</Label>
              <Input
                id="bufferAfter"
                name="bufferAfter"
                type="number"
                min={0}
                step={5}
                defaultValue={item?.bufferAfterMinutes ?? 0}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Couleur</Label>
            <div className="flex gap-2">
              {COLORS.map((c, i) => (
                <label key={c} className="cursor-pointer">
                  <input
                    type="radio"
                    name="color"
                    value={c}
                    defaultChecked={
                      item ? item.color === c : i === 0
                    }
                    className="peer sr-only"
                  />
                  <span
                    className="block size-7 rounded-full ring-2 ring-transparent ring-offset-2 peer-checked:ring-foreground"
                    style={{ backgroundColor: c }}
                  />
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={item?.isActive ?? true}
              className="size-4 rounded border-input"
            />
            Visible sur la page publique
          </label>

          <div className="space-y-3 rounded-lg border border-input p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={custom}
                onChange={(e) => setCustom(e.target.checked)}
                className="size-4 rounded border-input"
              />
              Horaires personnalisés pour cette prestation
            </label>
            {custom ? (
              <WeeklyHoursEditor value={byDay} onChange={setByDay} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Utilise les disponibilités générales.
              </p>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Enregistrer
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Annuler
            </Button>
          </div>
        </form>

        {/* Questions section — only shown for existing event types */}
        {item && (
          <div className="mt-6 space-y-4 border-t border-input pt-6">
            <p className="text-sm font-semibold">Questions d'inscription</p>

            {questions.length > 0 ? (
              <ul className="space-y-2">
                {questions.map((q) => (
                  <li
                    key={q.id}
                    className="flex items-center gap-3 rounded-md border border-input p-3 text-sm"
                  >
                    <span className="flex-1 font-medium">{q.label}</span>
                    <Badge variant="neutral">{q.type}</Badge>
                    {q.required && (
                      <Badge variant="neutral">Requis</Badge>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => onDeleteQuestion(q.id)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune question pour l'instant.</p>
            )}

            <form onSubmit={handleAddQuestion} className="space-y-3 rounded-lg border border-input p-4">
              <p className="text-xs font-medium text-muted-foreground">Ajouter une question</p>
              <div className="space-y-1.5">
                <Label htmlFor="qLabel">Libellé</Label>
                <Input
                  id="qLabel"
                  value={qLabel}
                  onChange={(e) => setQLabel(e.target.value)}
                  placeholder="Votre niveau ?"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="qType">Type</Label>
                  <select
                    id="qType"
                    value={qType}
                    onChange={(e) => setQType(e.target.value as "text" | "choice" | "boolean")}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="text">Texte libre</option>
                    <option value="choice">Choix multiple</option>
                    <option value="boolean">Oui / Non</option>
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={qRequired}
                      onChange={(e) => setQRequired(e.target.checked)}
                      className="size-4 rounded border-input"
                    />
                    Requis
                  </label>
                </div>
              </div>
              {qType === "choice" && (
                <div className="space-y-1.5">
                  <Label htmlFor="qOptions">Options (séparées par des virgules)</Label>
                  <Input
                    id="qOptions"
                    value={qOptions}
                    onChange={(e) => setQOptions(e.target.value)}
                    placeholder="Débutant, Intermédiaire, Avancé"
                  />
                </div>
              )}
              <Button type="submit" variant="secondary" size="sm" disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                <Plus className="size-3.5" />
                Ajouter
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
