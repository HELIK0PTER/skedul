"use client";

import "./globals.css";

import { PublicErrorCard } from "@/components/public/public-error-card";

/**
 * The error state of the root layout itself: it replaces that layout, so it brings its own <html lang="fr">, <body> and
 * global styles, and titles itself with React's <title> (a client boundary exports no metadata). The card logs the
 * digest only (G4b).
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="fr">
      <body className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-10 text-foreground antialiased">
        <title>Une erreur est survenue · Skedul</title>
        <PublicErrorCard scope="global" digest={error.digest} onRetry={() => unstable_retry()} homeHref="/" />
      </body>
    </html>
  );
}
