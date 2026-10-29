import type { Metadata } from "next";
import Link from "next/link";

import { stepIndex } from "@/components/demo/demo-script";
import { DemoTour } from "@/components/demo/demo-tour";
import { Logo } from "@/components/ui/logo";

// The root template adds « · Skedul »: the title names the page only.
export const metadata: Metadata = {
  title: "Démo",
  description:
    "Visite guidée en 2 minutes : la page publique, les tickets et les carnets, les séances et les rendez-vous, puis le back-office du pro.",
};

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string | string[] }>;
}) {
  // `?step=carnet` : la landing ouvre la visite sur l'étape dont parle chaque section (un id inconnu ouvre la première).
  const initialStep = stepIndex((await searchParams).step);

  return (
    <div className="bg-aurora flex min-h-screen flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link href="/" className="hover:opacity-80">
          <Logo />
        </Link>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Quitter la démo
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center pb-10 pt-4">
        <h1 className="sr-only">Démo Skedul, visite guidée du produit</h1>
        {/* Keyed: a new ?step= remounts the tour instead of keeping the old one. */}
        <DemoTour key={initialStep} initialStep={initialStep} />
      </main>
    </div>
  );
}
