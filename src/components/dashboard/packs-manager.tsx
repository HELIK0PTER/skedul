"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Ticket, Trash2 } from "lucide-react";

import { deletePack, savePack } from "@/server/pro";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/utils";

export interface PackItem {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  priceCents: number;
  eventTypeId: string | null;
  eventTitle: string | null;
  isActive: boolean;
  sold: number;
}

export interface EventTypeOption {
  id: string;
  title: string;
}

export function PacksManager({
  items,
  eventTypes,
}: {
  items: PackItem[];
  eventTypes: EventTypeOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>, id?: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const eventTypeId = String(f.get("eventTypeId") ?? "");
    startTransition(async () => {
      await savePack({
        id,
        name: String(f.get("name")),
        description: String(f.get("description") ?? ""),
        credits: Number(f.get("credits")),
        priceCents: Math.round(Number(f.get("price")) * 100),
        eventTypeId: eventTypeId === "" ? null : eventTypeId,
        isActive: f.get("isActive") === "on",
      });
      setEditing(null);
      router.refresh();
    });
  }

  function onDelete(id: string) {
    if (!confirm("Supprimer ce pack ?")) return;
    startTransition(async () => {
      await deletePack(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {items.map((item) =>
        editing === item.id ? (
          <PackForm
            key={item.id}
            item={item}
            eventTypes={eventTypes}
            pending={pending}
            onCancel={() => setEditing(null)}
            onSubmit={(e) => onSubmit(e, item.id)}
          />
        ) : (
          <Card key={item.id}>
            <CardContent className="flex flex-wrap items-center gap-4 p-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                <Ticket className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{item.name}</p>
                  {!item.isActive && <Badge variant="neutral">Masqué</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {item.credits} crédits · {formatMoney(item.priceCents)} ·{" "}
                  {item.eventTitle ?? "Toutes prestations"}
                </p>
              </div>
              <Badge variant="success">{item.sold} vendu(s)</Badge>
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
        <PackForm
          eventTypes={eventTypes}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSubmit={(e) => onSubmit(e)}
        />
      ) : (
        <Button variant="secondary" onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          Nouveau pack
        </Button>
      )}
    </div>
  );
}

function PackForm({
  item,
  eventTypes,
  pending,
  onCancel,
  onSubmit,
}: {
  item?: PackItem;
  eventTypes: EventTypeOption[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Card className="border-primary/40">
      <CardContent className="p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nom du pack</Label>
            <Input
              id="name"
              name="name"
              defaultValue={item?.name}
              placeholder="Pack 4 séances de coaching"
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
              <Label htmlFor="credits">Crédits (séances)</Label>
              <Input
                id="credits"
                name="credits"
                type="number"
                min={1}
                defaultValue={item?.credits ?? 4}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price">Prix total (€)</Label>
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
            <Label htmlFor="eventTypeId">Prestation associée</Label>
            <Select
              id="eventTypeId"
              name="eventTypeId"
              defaultValue={item?.eventTypeId ?? ""}
            >
              <option value="">Toutes les prestations</option>
              {eventTypes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </Select>
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
