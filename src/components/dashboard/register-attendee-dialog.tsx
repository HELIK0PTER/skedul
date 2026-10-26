"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { StatusMark } from "@/components/dashboard/status-mark";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { INLINE_LINK_CLASS } from "@/components/ui/link-class";
import { Select } from "@/components/ui/select";
import { changedKeys, withoutErrorsUnder } from "@/lib/back-office/form-errors";
import { plural } from "@/lib/back-office/format";
import type { RegisterInput } from "@/lib/back-office/planning-actions";
import type { CustomerHit } from "@/lib/back-office/planning-reads";
import type { PlanningItemVM } from "@/lib/back-office/planning-view";
import { newClientProblems, type NewClientValue } from "@/lib/back-office/register-form";
import { PRO_ERROR_MESSAGES, REQUEST_FAILED } from "@/lib/pro-messages";
import { BOOLEAN_ANSWERS, BOUNDS, type BookingMode } from "@/lib/tickets-vocab";
import {
  registerAttendeeAction,
  registerOptionsAction,
  searchCustomersAction,
} from "@/server/pro-planning";

/** The search waits for the pro to stop typing; the read itself needs two characters (the action answers [] below that). */
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MIN_CHARS = 2;
/** Same limit as the core's search schema and the customer e-mail schema. */
const EMAIL_MAX = 254;

const noop = () => {};

type Client = { kind: "existing"; id: string; name: string; email: string } | { kind: "new" };
/** The answer of one search, tagged with the trimmed query it answers. */
type Searched =
  | { key: string; ok: true; customers: CustomerHit[] }
  | { key: string; ok: false; error: string };
/** The answer of `registerOptionsAction` for one customer; the answers are kept per customer id, so a late answer for a client picked earlier never replaces the current one. */
type Options =
  | { ok: true; mode: BookingMode; alreadyBooked: boolean; usable: { id: string; label: string }[] }
  | { ok: false; error: string };
/** auto = the engine's mode-driven coverage (earliest-expiring ticket, or free); specific = auto with a forced ticket; guest = « Invité ». */
type Choice = "auto" | "specific" | "guest";
/** Where the focus goes once the next render is on screen (the button that was pressed is disabled by then). */
type Attention = { target: "field" | "error" };

/** The error keys (customerInputSchema paths) that editing each field of the new client resolves. */
const NEW_CLIENT_ERROR_KEYS: Record<keyof NewClientValue, readonly string[]> = {
  name: ["name"],
  email: ["email"],
  phone: ["phone"],
};

const CHOICE_LABELS: Record<BookingMode, Partial<Record<Choice, string>>> = {
  tickets: {
    auto: "Avec un ticket (celui qui expire le plus tôt)",
    specific: "Un ticket précis",
    guest: "Sans ticket (invité)",
  },
  free: { auto: "Inscription libre", guest: "Invité" },
  none: { guest: "Invité" },
};

/** « Inscrire »: search or create a client, pick how the seat is covered, answer the questions. */
export function RegisterAttendeeDialog({
  item,
  onClose,
  onDone,
}: {
  item: PlanningItemVM;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attention, setAttention] = useState<Attention | null>(null);

  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<Searched | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [optionsById, setOptionsById] = useState<Record<string, Options>>({});
  const [newClient, setNewClient] = useState<NewClientValue>({ name: "", email: "", phone: "" });
  const [picked, setPicked] = useState<Choice | null>(null);
  const [specificId, setSpecificId] = useState("");
  const [extraSeat, setExtraSeat] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // The picked result is gone from the page by the next render: the focus goes to the chip that replaces it, not to the page.
  const focusOnMount = useCallback((el: HTMLElement | null) => {
    el?.focus();
  }, []);

  // The submit button is disabled while the request runs, which drops the focus on the page: it lands on what the pro must read next.
  useEffect(() => {
    if (attention === null) return;
    if (attention.target === "field") {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    } else {
      errorBox.current?.focus();
    }
  }, [attention]);

  const trimmed = query.trim();
  // Only while the search box is on screen: coming back with « Changer » reads the list again.
  const searchKey = client === null && trimmed.length >= SEARCH_MIN_CHARS ? trimmed : null;

  useEffect(() => {
    if (searchKey === null) return;
    let stale = false;
    const timer = setTimeout(() => {
      searchCustomersAction({ q: searchKey })
        .then((res) => {
          if (stale) return;
          setSearched(
            res.ok
              ? { key: searchKey, ok: true, customers: res.customers }
              : { key: searchKey, ok: false, error: res.error },
          );
        })
        .catch(() => {
          if (!stale) setSearched({ key: searchKey, ok: false, error: REQUEST_FAILED });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [searchKey]);

  // An answer for an older query is never shown: neither its hits nor its refusal.
  const found = searchKey !== null && searched !== null && searched.key === searchKey ? searched : null;
  const searching = searchKey !== null && found === null;
  // What the status line under the search field says: the wait, then how many clients answer (null = nothing to say yet).
  const searchStatus: string | null = searching
    ? "Recherche…"
    : found !== null && found.ok
      ? found.customers.length === 0
        ? "Aucun client trouvé."
        : plural(found.customers.length, "client trouvé", "clients trouvés")
      : null;

  const existing = client?.kind === "existing" ? client : null;
  const existingOptions = existing !== null ? (optionsById[existing.id] ?? null) : null;
  const optionsLoading = existing !== null && existingOptions === null;
  const optionsFailure = existingOptions !== null && !existingOptions.ok ? existingOptions.error : null;
  const loadedOptions = existingOptions !== null && existingOptions.ok ? existingOptions : null;

  const mode: BookingMode = loadedOptions?.mode ?? item.bookingMode ?? "none";
  const usable = loadedOptions?.usable ?? [];
  const alreadyBooked = loadedOptions?.alreadyBooked ?? false;
  const hasTickets = usable.length > 0;
  const available: Choice[] =
    mode === "tickets" ? (hasTickets ? ["auto", "specific", "guest"] : ["guest"]) : mode === "free" ? ["auto", "guest"] : ["guest"];
  const choice: Choice = picked !== null && available.includes(picked) ? picked : available[0];
  const ticketId = choice === "specific" ? (usable.find((t) => t.id === specificId)?.id ?? usable[0]?.id ?? null) : null;

  // A new client is checked when « Inscrire » is pressed (the button says what is wrong instead of staying dead).
  const ready = existing !== null ? loadedOptions !== null && !alreadyBooked : client !== null;
  const canSubmit = ready && !pending;
  const showForm = client !== null && !optionsLoading && optionsFailure === null && !alreadyBooked;

  /** An edit drops the box above the buttons (it describes the last submit) and the message of the field it changed. */
  function editNewClient(patch: Partial<NewClientValue>) {
    const next = { ...newClient, ...patch };
    const keys = changedKeys(newClient, next).flatMap((key) => NEW_CLIENT_ERROR_KEYS[key]);
    setFieldErrors((errors) => withoutErrorsUnder(errors, keys));
    setError(null);
    setNewClient(next);
  }

  function chooseExisting(hit: CustomerHit) {
    setClient({ kind: "existing", id: hit.id, name: hit.name, email: hit.email });
    setPicked(null);
    setSpecificId("");
    setError(null);
    setFieldErrors({});
    // A client picked again is looked up again: drop the answer kept for it so the spinner shows until the fresh one.
    setOptionsById((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== hit.id)));
    registerOptionsAction({ occurrenceId: item.id, customerId: hit.id })
      .then((res) => {
        setOptionsById((prev) => ({
          ...prev,
          [hit.id]: res.ok
            ? { ok: true, mode: res.mode, alreadyBooked: res.alreadyBooked, usable: res.usable }
            : { ok: false, error: res.error },
        }));
      })
      .catch(() => setOptionsById((prev) => ({ ...prev, [hit.id]: { ok: false, error: REQUEST_FAILED } })));
  }

  function startNew() {
    setClient({ kind: "new" });
    setPicked(null);
    setError(null);
    setFieldErrors({});
  }

  function changeClient() {
    setClient(null);
    setPicked(null);
    setSpecificId("");
    setError(null);
    setFieldErrors({});
  }

  function submit() {
    if (client === null || !canSubmit) return;
    let customer: RegisterInput["customer"];
    let displayName: string;
    if (client.kind === "existing") {
      customer = { kind: "existing", customerId: client.id };
      displayName = client.name;
    } else {
      const problems = newClientProblems(newClient);
      if (problems !== null) {
        setFieldErrors(problems);
        setError(null);
        setAttention({ target: "field" });
        return;
      }
      const phone = newClient.phone.trim();
      displayName = newClient.name.trim();
      customer = { kind: "new", name: displayName, email: newClient.email.trim(), phone: phone === "" ? null : phone };
    }
    const answerList = item.questions.flatMap((q) => {
      const value = (answers[q.id] ?? "").trim();
      return value === "" ? [] : [{ questionId: q.id, value }];
    });
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      try {
        const res = await registerAttendeeAction({
          occurrenceId: item.id,
          customer,
          coverage: choice === "guest" ? "guest" : "auto",
          ticketId,
          extraSeat,
          answers: answerList,
        });
        if (!res.ok) {
          setError(res.error);
          setAttention({ target: "error" });
          return;
        }
        onDone(
          res.customerCreated
            ? `${displayName} est inscrit(e). Sa fiche client a été créée et un email de confirmation lui a été envoyé.`
            : `${displayName} est inscrit(e). Un email de confirmation lui a été envoyé.`,
        );
      } catch {
        setError(REQUEST_FAILED);
        setAttention({ target: "error" });
      }
    });
  }

  return (
    <Dialog open onClose={pending ? noop : onClose} title={`Inscrire à « ${item.title} »`}>
      <form
        method="post"
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        {client === null && (
          <div className="space-y-3">
            <FormField label="Rechercher un client" htmlFor={`${uid}-search`} help="Nom ou email, 2 caractères minimum.">
              <Input
                id={`${uid}-search`}
                type="search"
                autoComplete="off"
                autoFocus
                maxLength={EMAIL_MAX}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </FormField>
            {/* Always mounted, only its content changes: a live region that appears with its text is not reliably announced. Idle, it is empty and takes no room. */}
            <p
              role="status"
              className={searchStatus === null ? "sr-only" : "flex items-center gap-2 text-sm text-zinc-600"}
            >
              {searching && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {searchStatus}
            </p>
            {found !== null && !found.ok && <FormError message={found.error} />}
            {found !== null && found.ok && found.customers.length > 0 && (
              <ul className="space-y-1.5" aria-label="Clients trouvés">
                {found.customers.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => chooseExisting(hit)}
                      className="w-full cursor-pointer rounded-xl border border-border px-3 py-2 text-left text-sm break-words transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-medium">{hit.name}</span>
                      {" · "}
                      <span className="text-zinc-600">{hit.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={startNew}>
              <Plus />
              Nouveau client
            </Button>
          </div>
        )}

        {existing !== null && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2">
            <p
              ref={focusOnMount}
              tabIndex={-1}
              className="min-w-0 rounded text-sm break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-medium">{existing.name}</span>
              {" · "}
              <span className="text-zinc-600">{existing.email}</span>
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={changeClient} disabled={pending} className="shrink-0">
              Changer
            </Button>
          </div>
        )}

        {client?.kind === "new" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Nouveau client</p>
              <Button type="button" variant="ghost" size="sm" onClick={changeClient} disabled={pending}>
                Changer
              </Button>
            </div>
            <FormField label="Nom" htmlFor={`${uid}-name`} error={fieldErrors.name}>
              <Input
                id={`${uid}-name`}
                autoComplete="off"
                autoFocus
                value={newClient.name}
                maxLength={BOUNDS.name}
                disabled={pending}
                onChange={(e) => editNewClient({ name: e.target.value })}
              />
            </FormField>
            <FormField label="Email" htmlFor={`${uid}-email`} error={fieldErrors.email}>
              <Input
                id={`${uid}-email`}
                type="email"
                autoComplete="off"
                maxLength={EMAIL_MAX}
                value={newClient.email}
                disabled={pending}
                onChange={(e) => editNewClient({ email: e.target.value })}
              />
            </FormField>
            <FormField label="Téléphone" htmlFor={`${uid}-phone`} optional error={fieldErrors.phone}>
              <Input
                id={`${uid}-phone`}
                type="tel"
                autoComplete="off"
                maxLength={BOUNDS.phone}
                value={newClient.phone}
                disabled={pending}
                onChange={(e) => editNewClient({ phone: e.target.value })}
              />
            </FormField>
          </div>
        )}

        {optionsLoading && (
          <p role="status" className="flex items-center gap-2 text-sm text-zinc-600">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {"Vérification de l'inscription…"}
          </p>
        )}
        <FormError message={optionsFailure} />
        <FormError message={alreadyBooked ? PRO_ERROR_MESSAGES.already_booked : null} />

        {showForm && (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Couverture</legend>
              {mode === "tickets" && existing !== null && !hasTickets && (
                <p className="text-sm text-zinc-600">
                  {"Ce client n'a aucun ticket utilisable ici. "}
                  <Link
                    href={`/dashboard/clients/${existing.id}`}
                    className={INLINE_LINK_CLASS}
                  >
                    Ouvrir sa fiche
                  </Link>
                  {" pour lui offrir ou convertir un ticket."}
                </p>
              )}
              {available.map((c) => (
                <label key={c} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name={`${uid}-coverage`}
                    checked={choice === c}
                    disabled={pending}
                    onChange={() => {
                      setPicked(c);
                      setError(null);
                    }}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span>{CHOICE_LABELS[mode][c]}</span>
                </label>
              ))}
              {choice === "specific" && (
                <div className="pl-6">
                  <FormField label="Ticket à utiliser" htmlFor={`${uid}-ticket`}>
                    <Select
                      id={`${uid}-ticket`}
                      value={ticketId ?? ""}
                      disabled={pending}
                      onChange={(e) => {
                        setSpecificId(e.target.value);
                        setError(null);
                      }}
                    >
                      {usable.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>
              )}
              {mode === "tickets" && client?.kind === "new" && (
                <p className="text-xs text-zinc-600">{"Un nouveau client n'a pas encore de ticket."}</p>
              )}
              {mode === "none" && (
                <p className="text-xs text-zinc-600">
                  Séance sans réservation en ligne : le client est inscrit comme invité.
                </p>
              )}
            </fieldset>

            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  aria-describedby={`${uid}-extra-help`}
                  checked={extraSeat}
                  disabled={pending}
                  onChange={(e) => {
                    setExtraSeat(e.target.checked);
                    setError(null);
                  }}
                  className="size-4 shrink-0 accent-primary"
                />
                +1 place
              </label>
              <p id={`${uid}-extra-help`} className="text-xs text-zinc-600">
                Ajoute une place si la séance est complète.
              </p>
              {item.seatsShown === 0 && !extraSeat && (
                <p className="flex items-start gap-2 text-xs text-warning">
                  <StatusMark tone="orange" decorative className="mt-1" />
                  {"Séance complète. Cochez « +1 place » pour l'inscrire quand même."}
                </p>
              )}
            </div>

            {item.questions.length > 0 && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-medium">Réponses (facultatif)</legend>
                {item.questions.map((q) => {
                  const id = `${uid}-q-${q.id}`;
                  const value = answers[q.id] ?? "";
                  const choices: readonly string[] = q.type === "choice" ? (q.options ?? []) : BOOLEAN_ANSWERS;
                  const setAnswer = (next: string) => {
                    setAnswers((prev) => ({ ...prev, [q.id]: next }));
                    setError(null);
                  };
                  return (
                    <div key={q.id} className="wrap-anywhere">
                      <FormField label={q.label} htmlFor={id}>
                        {q.type === "text" ? (
                          <Input
                            id={id}
                            value={value}
                            maxLength={BOUNDS.answer}
                            disabled={pending}
                            onChange={(e) => setAnswer(e.target.value)}
                          />
                        ) : (
                          <Select id={id} value={value} disabled={pending} onChange={(e) => setAnswer(e.target.value)}>
                            <option value="">Sans réponse</option>
                            {choices.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </Select>
                        )}
                      </FormField>
                    </div>
                  );
                })}
              </fieldset>
            )}
          </>
        )}

        <FormError message={error} ref={errorBox} tabIndex={-1} />

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Retour
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending && <Loader2 className="animate-spin" />}
            Inscrire
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
