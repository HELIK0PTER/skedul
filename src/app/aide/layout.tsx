import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

import styles from "./help.module.css";

export const metadata: Metadata = {
  title: { default: "Centre d’aide", template: "%s · Centre d’aide · Skedul" },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(styles.root, "flex min-h-full flex-1 flex-col")}>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter note={null} />
    </div>
  );
}
