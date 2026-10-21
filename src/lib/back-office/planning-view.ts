/**
 * Pure planning view model (spec § 7, § 13.2). Everything the calendar draws
 * from the week's occurrences: wall-clock minutes and day keys are always read
 * in the pro's time zone, passed explicitly (never the host zone), lanes are
 * computed per day, an empty séance under a time off is hidden, ISO strings
 * replace dates so the result can cross the server/client boundary.
 * It also holds the small pure formatters the planning components share
 * (`hhmm`, `dayShortLabel`, `dayLongLabel`, `tintOf`, `blockLabel`, `previewTitle`, `unenrolledMessage`), so
 * that their copy is covered by the pure suite and the dash scan.
 * No server import: only `import type` from the reads module.
 */
import { addDays, parseKey, type DateKey } from "@/lib/civil-date";
import { dayKeyInTz, dayOrdinal, formatTime, frenchFirst, startOfDayKey, wallClockMinutes } from "@/lib/datetime";
import { expiryLabel, formatWhen, plural } from "@/lib/back-office/format";
import type { PlanningAttendee, PlanningItem, PlanningQuestion, PlanningTimeOff } from "@/lib/back-office/planning-reads";
import { layoutLanes, type LaneSlot } from "@/lib/lanes";
import type { BookingCoverage, BookingMode, OccurrenceStatus } from "@/lib/tickets-vocab";

export type PlanningAttendeeVM = {
  bookingId: string;
  customerId: string;
  name: string;
  email: string;
  phone: string | null;
  status: "pending" | "confirmed";
  coverage: BookingCoverage;
  /** « Cours collectif · valable jusqu'au 12/01 inclus » (+ « · offert ») */
  ticketLabel: string | null;
  /** « 19:45 », only while the booking is pending */
  holdUntil: string | null;
  /** pending and the hold has ended (`holdExpiresAt <= now`): the seat is already free, `holdUntil` is in the past */
  holdLapsed: boolean;
  answers: { label: string; value: string }[];
  notes: string | null;
  moved: boolean;
};

export type PlanningItemVM = {
  id: string;
  kind: "seance" | "rdv";
  eventId: string | null;
  eventVersion: number | null;
  title: string;
  color: string;
  startsAt: string;
  endsAt: string;
  dayKey: DateKey;
  startMinute: number;
  endMinute: number;
  lane: number;
  lanes: number;
  status: OccurrenceStatus;
  capacity: number;
  /** the raw seats_taken: also holds that lapsed and were not released yet; only the capacity floor reads it */
  seatsTaken: number;
  /** the « inscrits »: confirmed bookings plus the holds still live (see PlanningItem.liveSeats) */
  liveSeats: number;
  seatsShown: number;
  location: string | null;
  eventLocation: string | null;
  locationOverride: string | null;
  bookingMode: BookingMode | null;
  isPrivate: boolean;
  acceptedTypes: { id: string; name: string; color: string }[];
  questions: PlanningQuestion[];
  recurring: boolean;
  canRestore: boolean;
  timeDetached: boolean;
  started: boolean;
  past: boolean;
  attendees: PlanningAttendeeVM[];
};

export type TimeOffSegmentVM = {
  id: string;
  dayKey: DateKey;
  startMinute: number;
  endMinute: number;
  allDay: boolean;
  reason: string | null;
};

const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

/**
 * An empty scheduled event séance overlapping a time off is hidden (spec § 7); RDVs and booked or cancelled séances
 * never. Empty is measured on the live seats: a seat that only a lapsed hold keeps is already free.
 */
export function hiddenByTimeOff(
  item: Pick<PlanningItem, "kind" | "status" | "liveSeats" | "startsAt" | "endsAt">,
  timeOff: readonly { startAt: Date; endAt: Date }[],
): boolean {
  if (item.kind !== "seance" || item.status !== "scheduled" || item.liveSeats > 0) return false;
  return timeOff.some(
    (t) => item.startsAt.getTime() < t.endAt.getTime() && item.endsAt.getTime() > t.startAt.getTime(),
  );
}

function attendeeVM(a: PlanningAttendee, tz: string, now: Date): PlanningAttendeeVM {
  const ticketLabel = a.ticket
    ? `${a.ticket.typeName} · ${expiryLabel(a.ticket.expiresAt, tz, now)}${a.ticket.purchased ? "" : " · offert"}`
    : null;
  return {
    bookingId: a.bookingId,
    customerId: a.customerId,
    name: a.name,
    email: a.email,
    phone: a.phone,
    status: a.status,
    coverage: a.coverage,
    ticketLabel,
    holdUntil: a.status === "pending" && a.holdExpiresAt ? formatTime(a.holdExpiresAt, tz) : null,
    holdLapsed: a.status === "pending" && a.holdExpiresAt !== null && a.holdExpiresAt.getTime() <= now.getTime(),
    answers: a.answers,
    notes: a.customerNotes,
    moved: a.movedAt !== null,
  };
}

/**
 * Items → view models in tz: hidden ones dropped, wall-clock minutes (endMinute
 * 1440 when the end falls on a later day), lanes per day via layoutLanes, ISO
 * instants, ordered by start. `started` / `past` are measured against `now`.
 * With `days` (the displayed week), an item whose start day is not one of them
 * is dropped too: the range read also returns what only overlaps the week (a
 * séance of the previous Sunday 23:00 to Monday 00:30), which no column shows
 * and which must not widen the grid hours.
 */
export function toPlanningVM(
  items: readonly PlanningItem[],
  timeOff: readonly PlanningTimeOff[],
  tz: string,
  now: Date,
  days?: readonly DateKey[],
): PlanningItemVM[] {
  const shown = days === undefined ? null : new Set<string>(days);
  const placed = items
    .filter((i) => !hiddenByTimeOff(i, timeOff))
    .map((i) => {
      const dayKey = dayKeyInTz(i.startsAt, tz);
      const startMinute = wallClockMinutes(i.startsAt, tz);
      const sameDay = dayKeyInTz(i.endsAt, tz) === dayKey;
      // A repeated hour (DST fall back) can make the end read before the start.
      const endMinute = sameDay ? Math.min(1440, Math.max(wallClockMinutes(i.endsAt, tz), startMinute + 5)) : 1440;
      return { item: i, dayKey, startMinute, endMinute };
    })
    .filter((p) => shown === null || shown.has(p.dayKey))
    .sort(
      (a, b) =>
        a.item.startsAt.getTime() - b.item.startsAt.getTime() ||
        (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
    );

  // Lanes are per day: minutes of two different days must not be compared.
  const byDay = new Map<DateKey, { id: string; start: number; end: number }[]>();
  for (const p of placed) {
    const list = byDay.get(p.dayKey) ?? [];
    list.push({ id: p.item.id, start: p.startMinute, end: p.endMinute });
    byDay.set(p.dayKey, list);
  }
  const slots = new Map<string, LaneSlot>();
  for (const list of byDay.values()) {
    for (const [id, slot] of layoutLanes(list)) slots.set(id, slot);
  }

  return placed.map(({ item: i, dayKey, startMinute, endMinute }): PlanningItemVM => {
    const slot = slots.get(i.id) ?? { lane: 0, lanes: 1 };
    return {
      id: i.id,
      kind: i.kind,
      eventId: i.eventId,
      eventVersion: i.eventVersion,
      title: i.title,
      color: i.color,
      startsAt: i.startsAt.toISOString(),
      endsAt: i.endsAt.toISOString(),
      dayKey,
      startMinute,
      endMinute,
      lane: slot.lane,
      lanes: slot.lanes,
      status: i.status,
      capacity: i.capacity,
      seatsTaken: i.seatsTaken,
      liveSeats: i.liveSeats,
      seatsShown: i.seatsShown,
      location: i.location,
      eventLocation: i.eventLocation,
      locationOverride: i.locationOverride,
      bookingMode: i.bookingMode,
      isPrivate: i.isPrivate,
      acceptedTypes: i.acceptedTypes,
      questions: i.questions,
      recurring: i.recurring,
      canRestore: i.canRestore,
      timeDetached: i.timeDetached,
      started: i.startsAt.getTime() <= now.getTime(),
      past: i.endsAt.getTime() <= now.getTime(),
      attendees: i.attendees.map((a) => attendeeVM(a, tz, now)),
    };
  });
}

/** A time off cut into one segment per covered day of `days` (wall-clock minutes in tz, half-open on both ends). */
export function timeOffSegments(
  timeOff: readonly PlanningTimeOff[],
  days: readonly DateKey[],
  tz: string,
): TimeOffSegmentVM[] {
  const segments: TimeOffSegmentVM[] = [];
  for (const day of days) {
    const dayStart = startOfDayKey(day, tz).getTime();
    const dayEnd = startOfDayKey(addDays(day, 1), tz).getTime();
    for (const t of timeOff) {
      const start = t.startAt.getTime();
      const end = t.endAt.getTime();
      if (start >= dayEnd || end <= dayStart) continue;
      segments.push({
        id: t.id,
        dayKey: day,
        startMinute: start <= dayStart ? 0 : wallClockMinutes(t.startAt, tz),
        endMinute: end >= dayEnd ? 1440 : wallClockMinutes(t.endAt, tz),
        allDay: t.allDay,
        reason: t.reason,
      });
    }
  }
  return segments;
}

/** Visible hours: 8..21 widened by the items (a time off, all-day or not, never widens the grid). */
export function gridHours(items: readonly PlanningItemVM[]): { startHour: number; endHour: number } {
  let startHour = 8;
  let endHour = 21;
  for (const i of items) {
    startHour = Math.min(startHour, Math.floor(i.startMinute / 60));
    endHour = Math.max(endHour, Math.ceil(i.endMinute / 60));
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

/**
 * « 12 au 18 octobre 2026 », « 28 septembre au 4 octobre 2026 », « 29 décembre 2026 au 4 janvier 2027 »;
 * the first of a month is written « 1er » (« 26 octobre au 1er novembre 2026 »).
 */
export function weekTitle(days: readonly DateKey[]): string {
  if (days.length === 0) return "";
  const first = parseKey(days[0]);
  const last = parseKey(days[days.length - 1]);
  const firstMonth = MONTHS_FR[first.m - 1];
  const lastMonth = MONTHS_FR[last.m - 1];
  const a = dayOrdinal(first.d);
  const b = dayOrdinal(last.d);
  if (first.y === last.y && first.m === last.m) return `${a} au ${b} ${lastMonth} ${last.y}`;
  if (first.y === last.y) return `${a} ${firstMonth} au ${b} ${lastMonth} ${last.y}`;
  return `${a} ${firstMonth} ${first.y} au ${b} ${lastMonth} ${last.y}`;
}

/** Minute of a click offset in a day column, rounded down to 30, within 0..1410. */
export function minuteFromOffset(offsetPx: number, startHour: number, hourPx: number): number {
  const base = startHour * 60;
  const raw = Number.isFinite(offsetPx) && hourPx > 0 ? base + (offsetPx / hourPx) * 60 : base;
  return Math.min(1410, Math.max(0, Math.floor(raw / 30) * 30));
}

/** « 09:30 » from a wall-clock minute (1440 reads « 00:00 »). */
export function hhmm(minute: number): string {
  const m = minute % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Light tint of an event colour: the block text stays the foreground colour
 * (WCAG AA whatever colour the pro picked), the colour itself is carried by
 * the solid left bar.
 */
export function tintOf(color: string): string {
  return `color-mix(in srgb, ${color} 16%, white)`;
}

// A civil day is formatted at UTC noon in UTC: its weekday never depends on the host or pro zone.
const civilNoon = (day: DateKey): Date => new Date(`${day}T12:00:00Z`);

/** « lun. 12 » */
export function dayShortLabel(day: DateKey): string {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(civilNoon(day));
}

/** « lundi 12 octobre », « dimanche 1er novembre » */
export function dayLongLabel(day: DateKey): string {
  return frenchFirst(
    new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
      civilNoon(day),
    ),
  );
}

/**
 * The registrants of a séance, said one way everywhere (the grid block, its accessible name, the mobile list, the
 * dialog): « 2 inscrits sur 12 ». They are the confirmed bookings plus the holds still live (`liveSeats`); a hold
 * that has lapsed is a free seat, even before the engine releases it.
 */
export function seatsText(item: Pick<PlanningItemVM, "liveSeats" | "capacity">): string {
  return `${plural(item.liveSeats, "inscrit", "inscrits")} sur ${item.capacity}`;
}

/** « 2/12 »: the second line of a séance block and the title of the dashboard week preview. */
export function seatsRatio(item: Pick<PlanningItemVM, "liveSeats" | "capacity">): string {
  return `${item.liveSeats}/${item.capacity}`;
}

/** The line of the occurrence dialog: « 2 inscrits sur 12 · 10 places en ligne » (the two always add up to the capacity). */
export function seatsSummary(item: Pick<PlanningItemVM, "liveSeats" | "capacity" | "seatsShown">): string {
  return `${seatsText(item)} · ${plural(item.seatsShown, "place en ligne", "places en ligne")}`;
}

/**
 * The capacity floor of a séance. It is the raw seats_taken: the engine keeps `greatest(capacity, seats_taken)` and
 * does not release a lapsed hold first, so those seats count here although they are not registrants.
 */
export function minimumSeatsMessage(seatsTaken: number): string {
  if (seatsTaken <= 0) return "Minimum 1 place.";
  return `Minimum ${seatsTaken} : ${plural(seatsTaken, "place est déjà prise", "places sont déjà prises")}.`;
}

/**
 * The accessible name of a block of the week grid: title, when, then what the
 * block shows as its second line (the seats of a séance, the client of an RDV;
 * the seat count again when an RDV has no client to name), and « annulée ». A
 * button's name replaces its content, so the state must be part of it.
 */
export function blockLabel(
  item: Pick<PlanningItemVM, "title" | "kind" | "startsAt" | "endsAt" | "status" | "liveSeats" | "capacity"> & {
    attendees: readonly { name: string }[];
  },
  tz: string,
): string {
  const when = formatWhen(new Date(item.startsAt), new Date(item.endsAt), tz);
  const client = item.kind === "rdv" ? item.attendees[0]?.name : undefined;
  const detail = client ?? seatsText(item);
  return `${item.title}, ${when}, ${detail}${item.status === "cancelled" ? ", annulée" : ""}`;
}

/**
 * Title of the dashboard week card: « Cette semaine » in the week view; in the
 * day view « Aujourd'hui » for today, else the long label of the day shown.
 */
export function previewTitle(view: "day" | "week", shownDay: DateKey, todayKey: DateKey): string {
  if (view === "week") return "Cette semaine";
  return shownDay === todayKey ? "Aujourd'hui" : dayLongLabel(shownDay);
}

/**
 * The status line after « Désinscrire »: « Inscription de Thomas Leroy annulée.
 * Le ticket est rendu au client, qui est prévenu par email. » for one person,
 * « 2 inscriptions annulées. Les clients sont prévenus par email. » for several.
 * `cancelled` and `ticketsReturned` are the engine's counts. One count decides
 * the whole sentence, `cancelled` (a name list can lag the engine): the head
 * and the tail are both singular only when it is exactly 1 (the name is used
 * when exactly one is known), both plural above, and nothing is said about the
 * clients when it is 0.
 */
export function unenrolledMessage(names: readonly string[], cancelled: number, ticketsReturned: number): string {
  if (cancelled <= 0) return "Aucune inscription annulée.";
  const one = cancelled === 1;
  const who =
    one && names.length === 1
      ? `Inscription de ${names[0]} annulée.`
      : `${plural(cancelled, "inscription annulée", "inscriptions annulées")}.`;
  const tail =
    ticketsReturned > 0
      ? one
        ? "Le ticket est rendu au client, qui est prévenu par email."
        : "Les tickets sont rendus aux clients, qui sont prévenus par email."
      : one
        ? "Le client est prévenu par email."
        : "Les clients sont prévenus par email.";
  return `${who} ${tail}`;
}
