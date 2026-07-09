import type { Metadata } from "next";
import Link from "next/link";

import { DemoTour } from "@/components/demo/demo-tour";
import { Logo } from "@/components/ui/logo";

export const metadata: Metadata = {
  title: "Démo — Skedul",
  description:
    "Visite guidée : réservation, packs d'heures prépayées et back-office pro, en 2 minutes.",
};

export default function DemoPage() {
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
        <h1 className="sr-only">Démo Skedul — visite guidée du produit</h1>
        <DemoTour />
      </main>
    </div>
  );
}
