import { stopImpersonation } from "@/server/admin";

/** Shown in the pro back-office while an admin is "connecté en tant que". */
export function ImpersonationBanner({ name, email }: { name: string; email: string }) {
  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-ink px-4 py-2 text-sm text-ink-foreground">
      <span>
        Vous êtes connecté en tant que <strong>{name}</strong> ({email})
      </span>
      <form action={stopImpersonation}>
        <button
          type="submit"
          className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25"
        >
          Revenir à l&apos;admin
        </button>
      </form>
    </div>
  );
}
