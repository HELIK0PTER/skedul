import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Skedul · Séances, carnets de tickets et rendez-vous",
    template: "%s · Skedul",
  },
  description:
    "Vendez des tickets à l'unité ou en carnets. Vos clients réservent vos séances et vos rendez-vous en ligne, et retrouvent leurs tickets dans leur espace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <PageViewTracker />
        <Analytics />
      </body>
    </html>
  );
}
