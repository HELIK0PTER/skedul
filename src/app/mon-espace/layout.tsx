import styles from "@/app/aide/help.module.css";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

/**
 * The shell of /mon-espace: the site header and footer, not a pro's page, because the client space spans every pro
 * (COV-M15, no pro branding). The header and the footer read the landing's `--lp-*` tokens; the help center scopes a
 * light copy of them with `styles.root`, reused here so the values stay in one place. A layout keeps the header
 * across the loading and error states of the segment.
 */
export default function MySpaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(styles.root, "flex min-h-full flex-1 flex-col")}>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter note={null} />
    </div>
  );
}
