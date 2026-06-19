"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Clock, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { deleteEventType, saveEventType } from "@/server/pro";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/utils";

export interface EventTypeItem {
  id: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  color: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  isActive: boolean;
}

const COLORS = ["#6d5cf6", "#0ea5e9", "#16a34a", "#f59e0b", "#ec4899", "#ef4444"];

export function EventTypesManager({ items }: { items: EventTypeItem[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>, id?: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    startTransition(async () => {
      await saveEventType({
        id,
        title: String(f.get("title")),
        description: String(f.get("description") ?? ""),
        durationMinutes: Number(f.get("durationMinutes")),
        priceCents: Math.round(Number(f.get("price")) * 100),
        color: String(f.get("color")),
        bufferBeforeMinutes: Number(f.get("bufferBefore") ?? 0),
        bufferAfterMinutes: Number(f.get("bufferAfter") ?? 0),
        isActive: f.get("isActive") === "on",
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

  return (
    <div className="space-y-4">
      {items.map((item) =>
        editing === item.id ? (
          <EventTypeForm
            key={item.id}
            item={item}
            pending={pending}
            onCancel={() => setEditing(null)}
            onSubmit={(e) => onSubmit(e, item.id)}
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
          onCancel={() => setEditing(null)}
          onSubmit={(e) => onSubmit(e)}
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
  onCancel,
  onSubmit,
}: {
  item?: EventTypeItem;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Card className="border-primary/40">
      <CardContent className="p-5">
        <form onSubmit={onSubmit} className="space-y-4">
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
      </CardContent>
    </Card>
  );
}
