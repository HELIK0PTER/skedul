import Link from "next/link";

import { BrandAvatar } from "@/components/public/brand-avatar";
import { Logo } from "@/components/ui/logo";
import { brandThemeVars } from "@/lib/color";
import { cn } from "@/lib/utils";

export interface PublicBranding {
  businessName: string;
  headline?: string | null;
  brandColor: string;
  bannerUrl?: string | null;
  headerLayout?: string | null;
  avatarKind?: string | null;
  avatarStyle?: string | null;
  avatarSeed?: string | null;
  avatarUrl?: string | null;
}

export function PublicShell({
  branding,
  backHref,
  children,
}: {
  branding: PublicBranding;
  backHref?: string;
  children: React.ReactNode;
}) {
  const {
    businessName,
    headline,
    brandColor,
    bannerUrl,
    headerLayout,
    avatarKind,
    avatarStyle,
    avatarSeed,
    avatarUrl,
  } = branding;
  const centered = headerLayout === "vitrine";

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ ...brandThemeVars(brandColor), ["--brand" as string]: brandColor }}
    >
      <header className="border-b border-border">
        {bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bannerUrl} alt="" className="h-40 w-full object-cover sm:h-48" />
        ) : (
          <div
            className="h-24"
            style={{
              background: `linear-gradient(180deg, ${brandColor}22, transparent)`,
            }}
          />
        )}
        <div className="mx-auto max-w-3xl px-5 pb-8">
          <div
            className={cn(
              "-mt-10 flex gap-4",
              centered ? "flex-col items-center text-center" : "items-end",
            )}
          >
            <BrandAvatar
              name={businessName}
              avatarKind={avatarKind}
              avatarStyle={avatarStyle}
              avatarSeed={avatarSeed}
              avatarUrl={avatarUrl}
              className="size-20 border-4 border-card shadow-sm"
            />
            <div className={cn("min-w-0", centered ? "" : "pb-1")}>
              {backHref ? (
                <Link href={backHref} className="hover:underline">
                  <h1 className="truncate text-xl font-bold">{businessName}</h1>
                </Link>
              ) : (
                <h1 className="truncate text-xl font-bold">{businessName}</h1>
              )}
              {headline && (
                <p className="truncate text-sm text-muted-foreground">{headline}</p>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">{children}</main>

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
