import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { Logo } from "@/components/ui/logo";

export function PublicShell({
  businessName,
  headline,
  avatarUrl,
  brandColor,
  backHref,
  children,
}: {
  businessName: string;
  headline?: string | null;
  avatarUrl?: string | null;
  brandColor: string;
  backHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ ["--brand" as string]: brandColor }}
    >
      <header
        className="border-b border-border"
        style={{
          background: `linear-gradient(180deg, ${brandColor}14, transparent)`,
        }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-5 py-8">
          <Avatar
            name={businessName}
            src={avatarUrl}
            className="size-14 text-base"
            // brand-colored avatar fallback
          />
          <div className="min-w-0">
            {backHref ? (
              <Link href={backHref} className="hover:underline">
                <h1 className="truncate text-xl font-bold">{businessName}</h1>
              </Link>
            ) : (
              <h1 className="truncate text-xl font-bold">{businessName}</h1>
            )}
            {headline && (
              <p className="truncate text-sm text-muted-foreground">
                {headline}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        {children}
      </main>

      <footer className="border-t border-border py-6">
        <Link
          href="/"
          className="mx-auto flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Propulsé par <Logo withWordmark className="scale-90" />
        </Link>
      </footer>
    </div>
  );
}
