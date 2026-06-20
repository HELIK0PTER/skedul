"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarX2, Check, Clock, Loader2, Ticket } from "lucide-react";

import { bookWithCredit, bookWithPayment, lookupCredits } from "@/server/public";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Day {
  key: string;
  label: string;
  slots: { iso: string; time: string; seatsRemaining: number; capacity: number }[];
}

interface Question {
  id: string;
  label: string;
  type: "text" | "choice" | "boolean";
  options: string[] | null;
  required: boolean;
}

interface Props {
  professionalId: string;
  eventType: {
    id: string;
    title: string;
    durationMinutes: number;
    priceCents: number;
    capacity: number;
  };
  questions: Question[];
  days: Day[];
}

export function BookingFlow({ professionalId, eventType, questions, days }: Props) {
  const [selectedDay, setSelectedDay] = useState(days[0]?.key ?? null);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const day = days.find((d) => d.key === selectedDay);
  const free = eventType.priceCents <= 0;
  const isGroup = eventType.capacity > 1;

  // Check applicable credits (debounced) when a valid email is entered.
  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        if (active) setCredits(null);
        return;
      }
      const r = await lookupCredits({ professionalId, email });
      if (!active) return;
      const applicable = r.purchases
        .filter((p) => p.eventTypeId === null || p.eventTypeId === eventType.id)
        .reduce((sum, p) => sum + p.creditsRemaining, 0);
      setCredits(applicable);
    }, 350);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [email, professionalId, eventType.id]);

  function submit(mode: "credit" | "pay", form: HTMLFormElement) {
    const f = new FormData(form);
    const customer = {
      name: String(f.get("name")),
      email: String(f.get("email")),
      phone: String(f.get("phone") ?? "") || undefined,
    };
    const notes = String(f.get("notes") ?? "") || undefined;
    if (!selectedIso) {
      setError("Choisissez un créneau.");
      return;
    }
    const answerList = questions.map((q) => ({
      questionId: q.id,
      value: answers[q.id] ?? "",
    }));
    setError(null);
    startTransition(async () => {
      const action = mode === "credit" ? bookWithCredit : bookWithPayment;
      const res = await action({
        eventTypeId: eventType.id,
        startISO: selectedIso,
        customer,
        notes,
        answers: answerList,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.redirectUrl) window.location.href = res.redirectUrl;
    });
  }

  if (days.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <CalendarX2 className="size-8 text-muted-foreground" />
          <p className="font-medium">Aucun créneau disponible</p>
          <p className="text-sm text-muted-foreground">
            Revenez plus tard ou contactez le professionnel.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step 1 — pick a slot */}
      <Card>
        <CardContent className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4 text-primary" /> 1. Choisissez un créneau
          </h2>

          <div className="flex gap-2 overflow-x-auto pb-2">
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => {
                  setSelectedDay(d.key);
                  setSelectedIso(null);
                }}
                className={cn(
                  "shrink-0 rounded-xl border px-3 py-2 text-sm capitalize transition-colors",
                  selectedDay === d.key
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border hover:bg-muted",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {day?.slots.map((s) => {
              const full = s.seatsRemaining <= 0;
              return (
                <button
                  key={s.iso}
                  type="button"
                  disabled={full}
                  onClick={() => setSelectedIso(s.iso)}
                  className={cn(
                    "flex flex-col items-center rounded-xl border px-2 py-2 text-sm font-medium transition-colors",
                    full && "cursor-not-allowed opacity-40",
                    selectedIso === s.iso
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary hover:bg-accent",
                  )}
                >
                  {s.time}
                  {isGroup && (
                    <span className="text-[11px] font-normal opacity-80">
                      {full ? "Complet" : `${s.seatsRemaining} place${s.seatsRemaining > 1 ? "s" : ""}`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Step 2 — details & payment */}
      <Card className={cn(!selectedIso && "pointer-events-none opacity-50")}>
        <CardContent className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Check className="size-4 text-primary" /> 2. Vos informations
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Nom complet</Label>
                <Input id="name" name="name" required placeholder="Jean Dupont" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="jean@exemple.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Téléphone (optionnel)</Label>
              <Input id="phone" name="phone" placeholder="+33 6 …" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Message (optionnel)</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>

            {questions.map((q) => (
              <div key={q.id} className="space-y-1.5">
                <Label htmlFor={`q_${q.id}`}>
                  {q.label}
                  {q.required && <span className="text-destructive"> *</span>}
                </Label>
                {q.type === "text" && (
                  <Input
                    id={`q_${q.id}`}
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                    }
                  />
                )}
                {q.type === "boolean" && (
                  <select
                    id={`q_${q.id}`}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                    }
                  >
                    <option value="">—</option>
                    <option value="Oui">Oui</option>
                    <option value="Non">Non</option>
                  </select>
                )}
                {q.type === "choice" && (
                  <select
                    id={`q_${q.id}`}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                    }
                  >
                    <option value="">—</option>
                    {(q.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}

            {credits !== null && credits > 0 && (
              <div className="flex items-center gap-2 rounded-xl bg-success-muted px-3 py-2 text-sm text-success">
                <Ticket className="size-4" />
                Vous avez {credits} crédit(s) applicable(s) à cette prestation.
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              {credits !== null && credits > 0 && (
                <Button
                  type="button"
                  disabled={pending || !selectedIso}
                  onClick={(e) =>
                    submit("credit", e.currentTarget.form as HTMLFormElement)
                  }
                >
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  <Ticket className="size-4" />
                  Réserver avec 1 crédit
                </Button>
              )}
              <Button
                type="button"
                variant={credits && credits > 0 ? "secondary" : "primary"}
                disabled={pending || !selectedIso}
                onClick={(e) =>
                  submit("pay", e.currentTarget.form as HTMLFormElement)
                }
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                {free
                  ? "Confirmer la réservation"
                  : `Payer ${formatMoney(eventType.priceCents)}${isGroup ? " / pers." : ""}`}
              </Button>
            </div>

            {!free && (
              <p className="text-xs text-muted-foreground">
                Paiement sécurisé via Stripe.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
