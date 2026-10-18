"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { StatusMark } from "@/components/dashboard/status-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { plural } from "@/lib/back-office/format";
import { WEEKDAY_NAMES } from "@/lib/back-office/labels";
import type { MoveTargetVM } from "@/lib/back-office/planning-actions";
import { dayOfWeek, formatDayMonth } from "@/lib/civil-date";
import { PRO_ERROR_MESSAGES, REQUEST_FAILED } from "@/lib/pro-messages";
import { cn } from "@/lib/utils";
import { moveAttendeeAction, moveTargetsAction } from "@/server/pro-planning";

const EXPIRES_BEFORE = PRO_ERROR_MESSAGES.ticket_expires_before;
const CONVERT_REQUIRED = "Choisissez le type de ticket.";

const noop = () => {};

type Series = { seriesRootId: string; title: string };
/** The result of one `moveTargetsAction` call, tagged with the request it answers. */
type Loaded =
  | { key: string; ok: true; targets: MoveTargetVM[] }
  | { key: string; ok: false; error: string };
type DayGroup = { dayKey: string; targets: MoveTargetVM[] };
/** Where the focus goes once the next render is on screen (the button that was pressed is disabled by then). */
type Attention = { target: "error" | "warning" };

/** Targets grouped by local day, in day order (the sort is stable: times keep their order inside a day). */
function groupByDay(targets: readonly MoveTargetVM[]): DayGroup[] {
  const sorted = [...targets].sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));
  const groups: DayGroup[] = [];
  for (const target of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.dayKey === target.dayKey) last.targets.push(target);
    else groups.push({ dayKey: target.dayKey, targets: [target] });
  }
  return groups;
}

/** Q18 « Déplacer »: the pro's next séances that can take this registrant, with conversion and « quand même ». */
export function MoveAttendeeDialog({
  bookingId,
  customerName,
  onClose,
  onDone,
}: {
  bookingId: string;
  customerName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const uid = useId();
  const errorBox = useRef<HTMLParagraphElement>(null);
  const warningBox = useRef<HTMLParagraphElement>(null);
  const convertSelect = useRef<HTMLSelectElement>(null);
  const [pending, startTransition] = useTransition();
  const [seriesRootId, setSeriesRootId] = useState<string | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [convertTo, setConvertTo] = useState("");
  const [convertError, setConvertError] = useState<string | null>(null);
  const [forceNeeded, setForceNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attention, setAttention] = useState<Attention | null>(null);

  const key = `${bookingId}|${seriesRootId ?? "all"}`;

  useEffect(() => {
    let stale = false;
    moveTargetsAction({ bookingId, seriesRootId })
      .then((res) => {
        if (stale) return;
        if (!res.ok) {
          setLoaded({ key, ok: false, error: res.error });
          return;
        }
        setLoaded({ key, ok: true, targets: res.targets });
        if (seriesRootId === null) setSeriesList(res.series);
      })
      .catch(() => {
        if (!stale) setLoaded({ key, ok: false, error: REQUEST_FAILED });
      });
    return () => {
      stale = true;
    };
  }, [bookingId, seriesRootId, key]);

  // The move button is disabled while the request runs, which drops the focus on the page: it lands on what the pro must read next.
  useEffect(() => {
    if (attention?.target === "error") errorBox.current?.focus();
    else if (attention?.target === "warning") warningBox.current?.focus();
  }, [attention]);

  const current = loaded !== null && loaded.key === key ? loaded : null;
  const loading = current === null;
  const targets = current?.ok ? current.targets : [];
  const loadError = current !== null && !current.ok ? current.error : null;
  const groups = groupByDay(targets);
  // A full target, or one the client already holds a seat on, cannot be picked (the engine would refuse it).
  const selected = targets.find((t) => t.occurrenceId === targetId && !t.full && !t.customerBooked) ?? null;
  const needsConversion = selected !== null && !selected.accepted;
  const expiryWarning = selected !== null && (selected.expiresBefore || forceNeeded);

  function pickTarget(id: string) {
    setTargetId(id);
    setConvertTo("");
    setConvertError(null);
    setForceNeeded(false);
    setError(null);
  }

  function submit() {
    if (selected === null || pending) return;
    if (needsConversion && convertTo === "") {
      setConvertError(CONVERT_REQUIRED);
      convertSelect.current?.focus();
      return;
    }
    const targetOccurrenceId = selected.occurrenceId;
    const convertToTicketTypeId = needsConversion ? convertTo : null;
    const force = expiryWarning;
    setError(null);
    startTransition(async () => {
      try {
        const res = await moveAttendeeAction({
          bookingId,
          targetOccurrenceId,
          force,
          convertToTicketTypeId,
        });
        if (res.ok) {
          onDone("Inscription déplacée. Le client est prévenu par email.");
          return;
        }
        if (res.code === "ticket_expires_before") {
          setForceNeeded(true);
          setAttention({ target: "warning" });
          return;
        }
        setError(res.error);
        setAttention({ target: "error" });
      } catch {
        setError(REQUEST_FAILED);
        setAttention({ target: "error" });
      }
    });
  }

  return (
    <Dialog open onClose={pending ? noop : onClose} title={`Déplacer ${customerName}`}>
      <div className="space-y-4">
        <FormField label="Événement" htmlFor={`${uid}-series`}>
          <Select
            id={`${uid}-series`}
            value={seriesRootId ?? ""}
            disabled={pending}
            onChange={(e) => {
              setSeriesRootId(e.target.value === "" ? null : e.target.value);
              setTargetId(null);
              setConvertTo("");
              setConvertError(null);
              setForceNeeded(false);
              setError(null);
            }}
          >
            <option value="">Tous les événements</option>
            {seriesList.map((s) => (
              <option key={s.seriesRootId} value={s.seriesRootId}>
                {s.title}
              </option>
            ))}
          </Select>
        </FormField>

        {loading && (
          <p role="status" className="flex items-center gap-2 text-sm text-zinc-600">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Recherche des séances…
          </p>
        )}
        <FormError message={loadError} />
        {!loading && loadError === null && targets.length === 0 && (
          <p className="text-sm text-zinc-600">Aucune séance disponible dans les 60 prochains jours.</p>
        )}

        {groups.length > 0 && (
          // The 60 days make a long list: it scrolls on its own so that the conversion field and the buttons stay in reach.
          <div role="radiogroup" aria-label="Séances disponibles" className="-mx-1 max-h-[40vh] space-y-4 overflow-y-auto px-1 py-1">
            {groups.map((group) => (
              <div key={group.dayKey} className="space-y-2">
                <p className="text-xs font-medium capitalize text-zinc-600">
                  {`${WEEKDAY_NAMES[dayOfWeek(group.dayKey)]} ${formatDayMonth(group.dayKey)}`}
                </p>
                {group.targets.map((t) => {
                  const unavailable = t.full || t.customerBooked;
                  return (
                    <label
                      key={t.occurrenceId}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-3 text-sm",
                        unavailable ? "cursor-not-allowed bg-muted/40" : "cursor-pointer hover:bg-muted/50",
                        targetId === t.occurrenceId && !unavailable ? "border-primary bg-primary-muted/40" : "border-border",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${uid}-target`}
                        value={t.occurrenceId}
                        checked={targetId === t.occurrenceId && !unavailable}
                        disabled={unavailable || pending}
                        onChange={() => pickTarget(t.occurrenceId)}
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className={cn("wrap-anywhere", unavailable && "text-zinc-600")}>
                          {`${t.whenLabel} · ${t.title} · ${plural(t.seatsShown, "place", "places")}`}
                        </span>
                        <span className="flex flex-wrap gap-1.5">
                          {t.accepted ? (
                            <Badge variant="success">Accepté</Badge>
                          ) : (
                            <Badge variant="warning">Conversion nécessaire</Badge>
                          )}
                          {t.full && <Badge variant="neutral">Complet</Badge>}
                          {t.customerBooked && <Badge variant="neutral">Déjà inscrit(e)</Badge>}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {needsConversion && selected !== null && (
          <FormField label="Convertir le ticket en" htmlFor={`${uid}-convert`} error={convertError}>
            <Select
              id={`${uid}-convert`}
              ref={convertSelect}
              value={convertTo}
              disabled={pending}
              required
              onChange={(e) => {
                setConvertTo(e.target.value);
                setConvertError(null);
                setError(null);
              }}
            >
              <option value="" disabled>
                Choisir un type
              </option>
              {selected.conversionTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        {expiryWarning && (
          <p
            ref={warningBox}
            tabIndex={-1}
            role="status"
            className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StatusMark tone="orange" decorative className="mt-1.5" />
            {EXPIRES_BEFORE}
          </p>
        )}
        <FormError message={error} ref={errorBox} tabIndex={-1} />

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Retour
          </Button>
          <Button type="button" onClick={submit} disabled={selected === null || pending}>
            {pending && <Loader2 className="animate-spin" />}
            {expiryWarning ? "Déplacer quand même" : "Déplacer"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
