/**
 * RDV libre slot generator (spec L455-462, L500-507, L869-877, L1498; P5 dossier § 3.4). Pure: no clock, no
 * database, no host time zone. Every instant is built from a local date and a wall minute by `instantAt`
 * (the pro's zone), days are walked as DateKeys with `addDays` (never n × 86 400 000 ms), and a slot's end
 * is its start plus the duration in ELAPSED milliseconds, like the engine (`bookRdv`, claims.ts).
 *
 * The grid (« calculés comme aujourd'hui », L89, ruling O2): for each rule of the day, starts every
 * `durationMin` from the rule's start while the slot fits before the rule's end. Buffers never move the
 * grid; they only widen the block that must miss every busy interval. The engine checks the hours
 * (`fitsAvailability`) and the window (`onlineBookability`) but not the grid: `isGridStart` is the check
 * the P5 action runs on a submitted start (OUT:76, CON:2306).
 */
import { addDays, dayOfWeek, instantAt, maxKey, minKey, todayKey, type DateKey } from "@/lib/civil-date";
import { fitsAvailability, lastBookableDate, onlineBookability, type BookingWindow } from "@/lib/booking-window";

/** One weekly hour range of the RDV type (its own rules when it has any, else the pro's: `rdvRules`). */
export type RdvRule = { dayOfWeek: number; startMinute: number; endMinute: number };

/** An instant range `[start, end)` the pro is busy in: a séance, a live RDV block, a time off. */
export type BusyInterval = { start: Date; end: Date };

/** An offered slot: the RDV's own times, without its buffers. */
export type RdvSlot = { start: Date; end: Date };

const MINUTE_MS = 60_000;

/** A positive whole number of minutes (a duration of 0, a fraction or NaN would loop or leave the minute grid). */
function isPositiveMinutes(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/** A rule the generator can walk: whole minutes, 0 ≤ start < end ≤ 1440 (the DB CHECKs, re-checked so nothing loops). */
function isWalkable(rule: RdvRule): boolean {
  return (
    Number.isInteger(rule.startMinute) &&
    Number.isInteger(rule.endMinute) &&
    rule.startMinute >= 0 &&
    rule.startMinute < rule.endMinute &&
    rule.endMinute <= 1440
  );
}

/**
 * The grid starts of local date `key` (pro zone), sorted and unique. For each rule of that weekday:
 * `t = startMinute, startMinute + dur, …` while `t + dur <= endMinute`, then `start = instantAt(key, t)`.
 * A spring-forward gap shifts a start forward (`instantAt`): the duplicate it can make is dropped (also for
 * overlapping stored rules), and a shifted start whose elapsed end overruns its rule is dropped by
 * `fitsAvailability`. A fall-back repeated hour gets no start of its own (`instantAt` takes the first
 * instant), like the engine. Only starts whose local date is `key` are kept.
 */
export function gridStartsOfDay(a: { rules: readonly RdvRule[]; durationMin: number; tz: string; key: DateKey }): Date[] {
  const { rules, durationMin, tz, key } = a;
  if (!isPositiveMinutes(durationMin)) return [];
  const weekday = dayOfWeek(key);
  const seen = new Set<number>();
  const starts: Date[] = [];
  for (const rule of rules) {
    if (rule.dayOfWeek !== weekday || !isWalkable(rule)) continue;
    for (let t = rule.startMinute; t + durationMin <= rule.endMinute; t += durationMin) {
      const start = instantAt(key, t, tz);
      const ms = start.getTime();
      if (seen.has(ms)) continue;
      seen.add(ms);
      const end = new Date(ms + durationMin * MINUTE_MS);
      if (todayKey(start, tz) !== key) continue;
      if (!fitsAvailability(rules, start, end, tz)) continue;
      starts.push(start);
    }
  }
  return starts.sort((x, y) => x.getTime() - y.getTime());
}

/**
 * True when `startsAt` is exactly (to the millisecond) one of the grid starts of its own local date. Never a
 * modulus on wall minutes: on a gap day the shifted starts are not on it. 10:07, 10:00:30, 10:00:00.001, an
 * instant outside the hours and an invalid date are all refused.
 */
export function isGridStart(a: { rules: readonly RdvRule[]; durationMin: number; tz: string; startsAt: Date }): boolean {
  const ms = a.startsAt.getTime();
  if (!Number.isFinite(ms) || ms % MINUTE_MS !== 0) return false;
  const key = todayKey(a.startsAt, a.tz);
  return gridStartsOfDay({ rules: a.rules, durationMin: a.durationMin, tz: a.tz, key }).some((s) => s.getTime() === ms);
}

/**
 * The bookable slots of the local dates `fromKey..toKey` (inclusive), sorted by start. The dates are first
 * bounded by today and by the horizon (`lastBookableDate`, inclusive), so nothing past the horizon is ever
 * generated. A grid start is kept when `onlineBookability` accepts it (start after now, notice, horizon:
 * the call the engine's plan makes) and its block `[start − bufferBefore, end + bufferAfter)` overlaps no
 * busy interval (`[)` ranges: blocks that only touch are allowed, like `tstzrange &&` in the EXCLUDE).
 */
export function computeSlots(a: {
  rules: readonly RdvRule[];
  busy: readonly BusyInterval[];
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  tz: string;
  fromKey: DateKey;
  toKey: DateKey;
  window: BookingWindow;
  now: Date;
}): RdvSlot[] {
  const { rules, busy, durationMin, bufferBeforeMin, bufferAfterMin, tz, window, now } = a;
  if (!isPositiveMinutes(durationMin)) return [];
  const first = maxKey(a.fromKey, todayKey(now, tz));
  const last = minKey(a.toKey, lastBookableDate(now, tz, window.bookingHorizonDays));
  const slots: RdvSlot[] = [];
  for (let key = first; key <= last; key = addDays(key, 1)) {
    for (const start of gridStartsOfDay({ rules, durationMin, tz, key })) {
      if (!onlineBookability({ startsAt: start, now, tz, window }).ok) continue;
      const end = new Date(start.getTime() + durationMin * MINUTE_MS);
      const blockStart = start.getTime() - bufferBeforeMin * MINUTE_MS;
      const blockEnd = end.getTime() + bufferAfterMin * MINUTE_MS;
      if (busy.some((b) => b.start.getTime() < blockEnd && b.end.getTime() > blockStart)) continue;
      slots.push({ start, end });
    }
  }
  return slots;
}
