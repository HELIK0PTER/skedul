# Disponibilités personnalisées par prestation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à chaque prestation (`event_type`) d'avoir, optionnellement, son propre planning hebdomadaire qui remplace totalement le planning global du pro.

**Architecture:** Une colonne nullable `eventTypeId` sur `availability_rule` distingue les règles globales (`NULL`) des règles propres à une prestation. La résolution « remplacement total » vit dans `loadBookableSlots` (source unique pour l'affichage public et la garde anti-race). L'UI réutilise un éditeur hebdomadaire extrait en composant partagé.

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle + Neon HTTP, React 19, Tailwind v4.

## Global Constraints

- Next.js 16 : `params`/`searchParams` async (`await params`). Server actions dans `src/server/*.ts` (`"use server"`), queries read-only dans `queries.ts` (`import "server-only"`).
- Neon HTTP : **pas de transaction interactive**. delete+insert séquentiels acceptés (pattern existant).
- Pas de runner de test : portes vertes = `pnpm typecheck` et `pnpm build`.
- Schéma modifié → `pnpm db:generate` puis `pnpm db:migrate` (cible `DATABASE_URL` via `.env.local`).
- Tout en français côté UI, primitives `src/components/ui/*`, thème violet.

---

## File Structure

- `src/lib/db/schema.ts` — colonne `eventTypeId` + index + relations.
- `drizzle/` — migration générée (additive).
- `src/lib/slots.ts` — résolution des règles (remplacement total).
- `src/server/pro.ts` — `saveEventType` (param `availability`), fix scope `saveAvailability`.
- `src/server/queries.ts` — `getProAvailability` (filtre global), `getProEventTypeRules` (nouveau).
- `src/components/dashboard/weekly-hours-editor.tsx` — **nouveau** composant partagé + helpers.
- `src/components/dashboard/availability-editor.tsx` — consomme le composant partagé.
- `src/components/dashboard/event-types-manager.tsx` — section « Horaires personnalisés » + badge.
- `src/app/dashboard/event-types/page.tsx` — charge et regroupe les règles par presta.

---

### Task 1: Schéma + migration

**Files:**
- Modify: `src/lib/db/schema.ts` (table `availabilityRule` + relations)
- Create: migration sous `drizzle/`

**Interfaces:**
- Produces: colonne `availabilityRule.eventTypeId: text | null`, index `availability_event_type_idx`.

- [ ] **Step 1: Ajouter la colonne + index** dans `availabilityRule` (la table est définie après `eventType`, la référence est donc valide) :

```ts
export const availabilityRule = pgTable(
  "availability_rule",
  {
    id: id(),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    // null = planning global du pro ; renseigné = override pour cette prestation
    eventTypeId: text("event_type_id").references(() => eventType.id, {
      onDelete: "cascade",
    }),
    // 0 = Sunday … 6 = Saturday
    dayOfWeek: integer("day_of_week").notNull(),
    // minutes from midnight (e.g. 540 = 09:00, 1020 = 17:00)
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    ...timestamps,
  },
  (t) => [
    index("availability_pro_idx").on(t.professionalId),
    index("availability_event_type_idx").on(t.eventTypeId),
  ],
);
```

- [ ] **Step 2: Relations** — ajouter `availabilityRules: many(availabilityRule)` à `eventTypeRelations`, et créer `availabilityRuleRelations` :

```ts
export const eventTypeRelations = relations(eventType, ({ one, many }) => ({
  professional: one(professional, {
    fields: [eventType.professionalId],
    references: [professional.id],
  }),
  bookings: many(booking),
  availabilityRules: many(availabilityRule),
}));

export const availabilityRuleRelations = relations(availabilityRule, ({ one }) => ({
  professional: one(professional, {
    fields: [availabilityRule.professionalId],
    references: [professional.id],
  }),
  eventType: one(eventType, {
    fields: [availabilityRule.eventTypeId],
    references: [eventType.id],
  }),
}));
```

- [ ] **Step 3: Générer la migration** — `pnpm db:generate`. Vérifier le SQL : `ADD COLUMN "event_type_id"` (nullable) + `CREATE INDEX "availability_event_type_idx"`, **aucun** `DROP`.
- [ ] **Step 4: Appliquer** — `pnpm db:migrate` (si `.env.local`/`DATABASE_URL` dispo ; sinon noter à l'utilisateur).
- [ ] **Step 5: Typecheck** — `pnpm typecheck` (PASS).
- [ ] **Step 6: Commit** — `git add src/lib/db/schema.ts drizzle && git commit -m "feat(db): per-event-type availability rules"`

---

### Task 2: Résolution « remplacement total »

**Files:**
- Modify: `src/lib/slots.ts`

**Interfaces:**
- Consumes: `availabilityRule.eventTypeId` (Task 1).
- Produces: `EventTypeLike` gagne `id: string` ; `loadBookableSlots` choisit règles custom > globales.

- [ ] **Step 1:** Étendre `EventTypeLike` et la requête. Imports : ajouter `isNull, or`.

```ts
import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";

interface EventTypeLike {
  id: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

export async function loadBookableSlots(
  professionalId: string,
  timezone: string,
  evt: EventTypeLike,
  daysAhead = 21,
): Promise<Slot[]> {
  const now = new Date();

  const [allRules, busy] = await Promise.all([
    db
      .select({
        eventTypeId: availabilityRule.eventTypeId,
        dayOfWeek: availabilityRule.dayOfWeek,
        startMinute: availabilityRule.startMinute,
        endMinute: availabilityRule.endMinute,
      })
      .from(availabilityRule)
      .where(
        and(
          eq(availabilityRule.professionalId, professionalId),
          or(
            isNull(availabilityRule.eventTypeId),
            eq(availabilityRule.eventTypeId, evt.id),
          ),
        ),
      ),
    db
      .select({ startAt: booking.startAt, endAt: booking.endAt })
      .from(booking)
      .where(
        and(
          eq(booking.professionalId, professionalId),
          gte(booking.startAt, now),
          inArray(booking.status, ["pending", "confirmed"]),
        ),
      ),
  ]);

  // remplacement total : si la presta a ≥1 règle propre, on ignore le global.
  const custom = allRules.filter((r) => r.eventTypeId === evt.id);
  const rules = custom.length > 0 ? custom : allRules.filter((r) => r.eventTypeId === null);

  return computeSlots({
    rules,
    busy,
    durationMinutes: evt.durationMinutes,
    bufferBeforeMinutes: evt.bufferBeforeMinutes,
    bufferAfterMinutes: evt.bufferAfterMinutes,
    timezone,
    daysAhead,
    now,
  });
}
```

(`isSlotAvailable` est inchangé : il reçoit déjà `evt` avec `id` via `row.eventType`. Les call sites — page `book/[eventTypeId]` et `public.ts` — passent la ligne `eventType` complète, qui a `id`.)

- [ ] **Step 2: Typecheck** — `pnpm typecheck` (PASS).
- [ ] **Step 3: Commit** — `git add src/lib/slots.ts && git commit -m "feat(slots): resolve per-event-type availability (full replacement)"`

---

### Task 3: Server actions + queries

**Files:**
- Modify: `src/server/pro.ts`
- Modify: `src/server/queries.ts`

**Interfaces:**
- Produces: `saveEventType` accepte `availability?: { customized: boolean; rules: AvailRule[] }` où `AvailRule = { dayOfWeek: number; startMinute: number; endMinute: number }`. `getProEventTypeRules(proId)` renvoie `{ eventTypeId, dayOfWeek, startMinute, endMinute }[]`.

- [ ] **Step 1: `saveEventType`** — ajouter le champ `availability`, garantir l'ownership via `.returning`, gérer les règles. Remplacer la fonction par :

```ts
export async function saveEventType(input: {
  id?: string;
  title: string;
  description?: string;
  durationMinutes: number;
  priceCents: number;
  color?: string;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  isActive?: boolean;
  availability?: {
    customized: boolean;
    rules: { dayOfWeek: number; startMinute: number; endMinute: number }[];
  };
}) {
  const pro = await requirePro();
  let eventTypeId: string | undefined;

  if (input.id) {
    const updated = await db
      .update(eventType)
      .set({
        title: input.title,
        description: input.description || null,
        durationMinutes: input.durationMinutes,
        priceCents: input.priceCents,
        color: input.color || "#6d5cf6",
        bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
        bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
        isActive: input.isActive ?? true,
      })
      .where(
        and(eq(eventType.id, input.id), eq(eventType.professionalId, pro.id)),
      )
      .returning({ id: eventType.id });
    if (updated.length === 0) return; // pas la presta de ce pro
    eventTypeId = updated[0].id;
  } else {
    let slug = slugify(input.title) || "rdv";
    let n = 1;
    while (
      (
        await db
          .select({ id: eventType.id })
          .from(eventType)
          .where(
            and(
              eq(eventType.professionalId, pro.id),
              eq(eventType.slug, slug),
            ),
          )
          .limit(1)
      ).length > 0
    ) {
      slug = `${slugify(input.title)}-${++n}`;
    }
    const [created] = await db
      .insert(eventType)
      .values({
        professionalId: pro.id,
        title: input.title,
        slug,
        description: input.description || null,
        durationMinutes: input.durationMinutes,
        priceCents: input.priceCents,
        color: input.color || "#6d5cf6",
        bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
        bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
        isActive: input.isActive ?? true,
      })
      .returning({ id: eventType.id });
    eventTypeId = created.id;
  }

  // disponibilités personnalisées : on remplace les règles de CETTE presta
  if (input.availability && eventTypeId) {
    await db
      .delete(availabilityRule)
      .where(
        and(
          eq(availabilityRule.eventTypeId, eventTypeId),
          eq(availabilityRule.professionalId, pro.id),
        ),
      );
    const valid = input.availability.customized
      ? input.availability.rules.filter((r) => r.endMinute > r.startMinute)
      : [];
    if (valid.length > 0) {
      await db.insert(availabilityRule).values(
        valid.map((r) => ({
          professionalId: pro.id,
          eventTypeId,
          dayOfWeek: r.dayOfWeek,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
        })),
      );
    }
  }

  revalidatePath("/dashboard/event-types");
  revalidatePath(`/${pro.slug}`);
}
```

- [ ] **Step 2: `saveAvailability`** — scoper le delete au planning global. Importer `isNull` (ajouter à l'import `drizzle-orm` en tête : `import { and, eq, isNull } from "drizzle-orm";`). Modifier le delete :

```ts
  await db
    .delete(availabilityRule)
    .where(
      and(
        eq(availabilityRule.professionalId, pro.id),
        isNull(availabilityRule.eventTypeId),
      ),
    );
```

(L'insert global laisse `eventTypeId` non renseigné → `null`. Inchangé.)

- [ ] **Step 3: `queries.ts`** — filtrer le global + ajouter la query par-presta. Imports : ajouter `isNotNull` (et `isNull`) à l'import `drizzle-orm`.

```ts
export function getProAvailability(proId: string) {
  return db
    .select()
    .from(availabilityRule)
    .where(
      and(
        eq(availabilityRule.professionalId, proId),
        isNull(availabilityRule.eventTypeId),
      ),
    )
    .orderBy(asc(availabilityRule.dayOfWeek), asc(availabilityRule.startMinute));
}

export function getProEventTypeRules(proId: string) {
  return db
    .select({
      eventTypeId: availabilityRule.eventTypeId,
      dayOfWeek: availabilityRule.dayOfWeek,
      startMinute: availabilityRule.startMinute,
      endMinute: availabilityRule.endMinute,
    })
    .from(availabilityRule)
    .where(
      and(
        eq(availabilityRule.professionalId, proId),
        isNotNull(availabilityRule.eventTypeId),
      ),
    )
    .orderBy(asc(availabilityRule.dayOfWeek), asc(availabilityRule.startMinute));
}
```

- [ ] **Step 4: Typecheck** — `pnpm typecheck` (PASS).
- [ ] **Step 5: Commit** — `git add src/server/pro.ts src/server/queries.ts && git commit -m "feat(pro): save & query per-event-type availability"`

---

### Task 4: Éditeur hebdomadaire partagé + UI prestation

**Files:**
- Create: `src/components/dashboard/weekly-hours-editor.tsx`
- Modify: `src/components/dashboard/availability-editor.tsx`
- Modify: `src/components/dashboard/event-types-manager.tsx`
- Modify: `src/app/dashboard/event-types/page.tsx`

**Interfaces:**
- Produces: `WeeklyHoursEditor({ value: ByDay; onChange })`, `type ByDay = Record<number, Range[]>`, helpers `emptyByDay()`, `byDayFromRules(rules)`, `rulesFromByDay(byDay)`.
- Consumes: `saveEventType.availability` (Task 3), `getProEventTypeRules` (Task 3).

- [ ] **Step 1: Créer `weekly-hours-editor.tsx`** (extraction de la grille jour-par-jour, sans bouton enregistrer) :

```tsx
"use client";

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Range = { start: string; end: string };
export type ByDay = Record<number, Range[]>;
export type Rule = { dayOfWeek: number; startMinute: number; endMinute: number };

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  0: "Dimanche",
};

export const toHHMM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function emptyByDay(): ByDay {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

export function byDayFromRules(rules: Rule[]): ByDay {
  const base = emptyByDay();
  for (const r of rules) {
    base[r.dayOfWeek].push({ start: toHHMM(r.startMinute), end: toHHMM(r.endMinute) });
  }
  return base;
}

export function rulesFromByDay(byDay: ByDay): Rule[] {
  const rules: Rule[] = [];
  for (const day of DAY_ORDER) {
    for (const r of byDay[day]) {
      rules.push({
        dayOfWeek: day,
        startMinute: toMinutes(r.start),
        endMinute: toMinutes(r.end),
      });
    }
  }
  return rules;
}

export function WeeklyHoursEditor({
  value,
  onChange,
}: {
  value: ByDay;
  onChange: (next: ByDay) => void;
}) {
  function update(day: number, ranges: Range[]) {
    onChange({ ...value, [day]: ranges });
  }

  return (
    <div className="space-y-3">
      {DAY_ORDER.map((day) => {
        const ranges = value[day];
        const enabled = ranges.length > 0;
        return (
          <Card key={day}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
              <button
                type="button"
                onClick={() =>
                  update(day, enabled ? [] : [{ start: "09:00", end: "17:00" }])
                }
                className={cn(
                  "flex w-32 shrink-0 items-center gap-2 text-sm font-medium",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
                    enabled ? "bg-primary" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "size-4 rounded-full bg-white shadow transition-transform",
                      enabled && "translate-x-4",
                    )}
                  />
                </span>
                {DAY_LABELS[day]}
              </button>

              <div className="flex-1 space-y-2">
                {!enabled && (
                  <p className="text-sm text-muted-foreground">Indisponible</p>
                )}
                {ranges.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={r.start}
                      onChange={(e) => {
                        const next = [...ranges];
                        next[i] = { ...r, start: e.target.value };
                        update(day, next);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
                    />
                    <span className="text-muted-foreground">–</span>
                    <input
                      type="time"
                      value={r.end}
                      onChange={(e) => {
                        const next = [...ranges];
                        next[i] = { ...r, end: e.target.value };
                        update(day, next);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => update(day, ranges.filter((_, j) => j !== i))}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                {enabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      update(day, [...ranges, { start: "09:00", end: "17:00" }])
                    }
                  >
                    <Plus className="size-4" />
                    Ajouter une plage
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Réécrire `availability-editor.tsx`** pour consommer le composant partagé :

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { saveAvailability } from "@/server/pro";
import { Button } from "@/components/ui/button";
import {
  WeeklyHoursEditor,
  byDayFromRules,
  rulesFromByDay,
  type ByDay,
} from "./weekly-hours-editor";

export function AvailabilityEditor({
  initial,
}: {
  initial: { dayOfWeek: number; startMinute: number; endMinute: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [byDay, setByDay] = useState<ByDay>(() => byDayFromRules(initial));

  function save() {
    const rules = rulesFromByDay(byDay);
    startTransition(async () => {
      await saveAvailability(rules);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <WeeklyHoursEditor
        value={byDay}
        onChange={(next) => {
          setByDay(next);
          setSaved(false);
        }}
      />
      <div className="flex items-center gap-3 pt-2">
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Enregistrer les disponibilités
        </Button>
        {saved && <span className="text-sm text-success">Enregistré ✓</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `event-types-manager.tsx`** — `EventTypeItem` gagne `availability`, le formulaire gagne la section custom, la carte gagne un badge. Changements précis :

`EventTypeItem` interface — ajouter :
```ts
  availability: { dayOfWeek: number; startMinute: number; endMinute: number }[];
```

Imports — ajouter `CalendarClock` à lucide-react et le composant partagé :
```ts
import { CalendarClock, Clock, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  WeeklyHoursEditor,
  byDayFromRules,
  rulesFromByDay,
  type ByDay,
} from "./weekly-hours-editor";
```

`onSubmit` du manager — accepter la dispo et la transmettre :
```tsx
  function onSubmit(
    e: React.FormEvent<HTMLFormElement>,
    id: string | undefined,
    availability: { customized: boolean; rules: { dayOfWeek: number; startMinute: number; endMinute: number }[] },
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
```

Les deux usages de `EventTypeForm` passent désormais `(e, availability)` :
```tsx
// presta existante
onSubmit={(e, availability) => onSubmit(e, item.id, availability)}
// nouvelle presta
onSubmit={(e, availability) => onSubmit(e, undefined, availability)}
```

Badge sur la carte lecture (à côté du badge « Masquée ») :
```tsx
{item.availability.length > 0 && (
  <Badge variant="neutral">
    <CalendarClock className="size-3.5" />
    Horaires perso
  </Badge>
)}
```

`EventTypeForm` — nouvelle signature `onSubmit`, état custom + éditeur :
```tsx
function EventTypeForm({
  item,
  pending,
  onCancel,
  onSubmit,
}: {
  item?: EventTypeItem;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (
    e: React.FormEvent<HTMLFormElement>,
    availability: { customized: boolean; rules: { dayOfWeek: number; startMinute: number; endMinute: number }[] },
  ) => void;
}) {
  const [custom, setCustom] = useState((item?.availability?.length ?? 0) > 0);
  const [byDay, setByDay] = useState<ByDay>(() =>
    byDayFromRules(item?.availability ?? []),
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    onSubmit(e, { customized: custom, rules: rulesFromByDay(byDay) });
  }

  return (
    <Card className="border-primary/40">
      <CardContent className="p-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* …tous les champs existants inchangés (titre, description, durée,
              prix, marges, couleur, isActive)… */}

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
      </CardContent>
    </Card>
  );
}
```

(La section custom s'insère juste avant le bloc des boutons Enregistrer/Annuler ; les champs existants entre `<form>` et ce bloc restent identiques.)

- [ ] **Step 4: `event-types/page.tsx`** — charger et regrouper les règles par presta :

```tsx
import { getProEventTypes, getProEventTypeRules } from "@/server/queries";

export default async function EventTypesPage() {
  const pro = (await getCurrentProfessional())!;
  const [rows, rules] = await Promise.all([
    getProEventTypes(pro.id),
    getProEventTypeRules(pro.id),
  ]);

  const byEvent = new Map<
    string,
    { dayOfWeek: number; startMinute: number; endMinute: number }[]
  >();
  for (const r of rules) {
    if (!r.eventTypeId) continue;
    const arr = byEvent.get(r.eventTypeId) ?? [];
    arr.push({
      dayOfWeek: r.dayOfWeek,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
    });
    byEvent.set(r.eventTypeId, arr);
  }

  const items: EventTypeItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    durationMinutes: r.durationMinutes,
    priceCents: r.priceCents,
    color: r.color,
    bufferBeforeMinutes: r.bufferBeforeMinutes,
    bufferAfterMinutes: r.bufferAfterMinutes,
    isActive: r.isActive,
    availability: byEvent.get(r.id) ?? [],
  }));

  return (
    <>
      <PageHeader
        title="Prestations"
        description="Les types de rendez-vous que vos clients peuvent réserver."
      />
      <EventTypesManager items={items} />
    </>
  );
}
```

- [ ] **Step 5: Typecheck + build** — `pnpm typecheck` puis `pnpm build` (PASS).
- [ ] **Step 6: Commit** — `git add src/components/dashboard/weekly-hours-editor.tsx src/components/dashboard/availability-editor.tsx src/components/dashboard/event-types-manager.tsx src/app/dashboard/event-types/page.tsx && git commit -m "feat(ui): per-prestation custom availability editor"`

---

## Self-Review

**Spec coverage:**
- Modèle de données (colonne nullable + index + cascade) → Task 1. ✓
- Résolution remplacement total + `EventTypeLike.id` → Task 2. ✓
- `saveEventType.availability`, fix `saveAvailability`, `getProAvailability` filtré, `getProEventTypeRules` → Task 3. ✓
- `WeeklyHoursEditor` partagé, refonte `AvailabilityEditor`, section custom + badge, page prestations → Task 4. ✓
- Cas « personnalisé mais vide » → `customized` false ou `valid.length === 0` ⇒ aucune ligne insérée (Task 3 Step 1). ✓
- Compatibilité time-off → aucune modif de `computeSlots`/`busy`, orthogonal. ✓

**Placeholder scan:** Aucun TBD/TODO ; code complet par étape. ✓

**Type consistency:** `Rule`/`{dayOfWeek,startMinute,endMinute}`, `ByDay`, `availability:{customized,rules}` cohérents entre Tasks 2–4. `EventTypeLike.id` consommé par call sites existants (lignes `eventType` complètes). ✓
