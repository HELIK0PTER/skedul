"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Loader2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { ENTRY_LABELS, type EntryChoice } from "@/lib/entry";
import { chooseEntry } from "@/server/entry";

const OPTIONS: { choice: EntryChoice; description: string; icon: LucideIcon }[] = [
  {
    choice: "admin",
    description: "Monitoring de l'app, utilisateurs, trafic.",
    icon: ShieldCheck,
  },
  {
    choice: "client",
    description: "Votre back-office de réservation.",
    icon: LayoutDashboard,
  },
];

/** Shown to admins after sign-in. It cannot be dismissed without choosing. */
export function EntryChooser({ open }: { open: boolean }) {
  const router = useRouter();
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState<EntryChoice | null>(null);
  const firstOption = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) firstOption.current?.focus();
  }, [open]);

  if (!open) return null;

  async function pick(choice: EntryChoice) {
    setPending(choice);
    const to = await chooseEntry(choice, remember);
    // Push only: a router.refresh() queued right after a server action leaves the
    // navigation pending forever (Next 16 router queue). The target is fetched fresh.
    router.push(to);
  }

  // Keep Tab inside the dialog (it has no close button by design).
  function trapFocus(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const items = e.currentTarget.querySelectorAll<HTMLElement>("button, input");
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-chooser-title"
        onKeyDown={trapFocus}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 id="entry-chooser-title" className="text-lg font-semibold">
          Accéder au :
        </h2>
        <div className="mt-4 grid gap-3">
          {OPTIONS.map(({ choice, description, icon: Icon }, i) => (
            <button
              key={choice}
              ref={i === 0 ? firstOption : undefined}
              type="button"
              disabled={pending !== null}
              onClick={() => pick(choice)}
              className="flex items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-muted text-accent-foreground">
                {pending === choice ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Icon className="size-5" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{ENTRY_LABELS[choice]}</span>
                <span className="block text-sm text-muted-foreground">
                  {description}
                </span>
              </span>
            </button>
          ))}
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="size-4 accent-primary"
          />
          Se souvenir de mon choix
        </label>
      </div>
    </div>
  );
}
