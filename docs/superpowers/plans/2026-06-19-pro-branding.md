# Branding personnalisé des pros — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à chaque pro de personnaliser sa page publique — bannière, avatar (galerie générée + pack 3D + upload), couleur de marque propagée aux boutons/accents, et choix de mise en page (Profil / Vitrine).

**Architecture:** Nouvelles colonnes sur `professional`. Uploads via Vercel Blob (flag `BLOB_ENABLED`, mode mock = upload désactivé). Avatars générés rendus côté serveur via `@dicebear/core`. Couleur de marque = surcharge des variables CSS Tailwind v4 (`--color-primary*`) sur le shell public. Pack 3D = PNG MIT (Microsoft Fluent 3D Emoji) embarqués dans `public/avatars/3d/`.

**Tech Stack:** Next.js 16 (App Router, RSC), Drizzle + Neon, Tailwind v4, `@vercel/blob`, `@dicebear/core` + `@dicebear/collection`, vitest (logique pure).

## Global Constraints

- `pnpm typecheck` et `pnpm build` doivent rester verts, **y compris sans** `BLOB_READ_WRITE_TOKEN` (cf. AGENTS.md).
- `params`/`searchParams` async (`await params`).
- Server Actions dans `src/server/*.ts`, lectures dans `queries.ts` (`server-only`).
- Pas de transaction interactive (Neon HTTP).
- Money en cents ; Time en minutes wall-clock (hors périmètre ici).
- UI = primitives `src/components/ui/`, `Button asChild` pour les liens, thème violet.
- Énumérations validées côté action serveur (pas d'enum Postgres) : `avatarKind ∈ {generated, pack, upload}`, `headerLayout ∈ {profil, vitrine}`, `avatarStyle ∈ {fun-emoji, micah, lorelei, pixel-art}`.

---

## File structure

**Créés**
- `src/lib/color.ts` — `brandTheme()`, `brandThemeVars()`.
- `src/lib/color.test.ts` — tests vitest.
- `src/lib/avatar.ts` — `resolveAvatar()`, `GENERATED_STYLES`, rendu SVG serveur.
- `src/lib/avatar.test.ts` — tests vitest.
- `src/lib/avatar-pack.ts` — manifeste du pack 3D (data pure, client-safe).
- `src/components/public/brand-avatar.tsx` — avatar polymorphe (RSC).
- `src/components/dashboard/branding-form.tsx` — UI back-office (client).
- `src/app/api/upload/route.ts` — upload Blob.
- `scripts/fetch-avatar-pack.ts` — télécharge les PNG 3D dans `public/avatars/3d/`.
- `public/avatars/3d/*` + `public/avatars/3d/LICENSE.md`.
- `vitest.config.ts`.

**Modifiés**
- `src/lib/db/schema.ts` — colonnes branding.
- `src/lib/env.ts` — `BLOB_READ_WRITE_TOKEN` + `BLOB_ENABLED`.
- `src/server/pro.ts` — action `updateBranding`.
- `src/components/public/public-shell.tsx` — bannière, layout, theming, `BrandAvatar`.
- `src/app/[slug]/page.tsx` + `[slug]/book/[eventTypeId]/page.tsx` + `[slug]/pack/[packId]/page.tsx` + `[slug]/merci/page.tsx` — passer les props branding.
- `src/components/dashboard/profile-form.tsx` — retirer le champ couleur (déplacé dans branding).
- `src/app/dashboard/settings/page.tsx` — rendre `BrandingForm`.
- `package.json` — deps.

---

## Task 1: Schéma + migration

**Files:** Modify `src/lib/db/schema.ts:125-127`

**Interfaces produces:** colonnes `bannerUrl`, `avatarKind`, `avatarStyle`, `avatarSeed` (nullable text), `headerLayout` (text default `'profil'` not null).

- [ ] **Step 1:** Dans `professional`, remplacer le bloc `avatarUrl … brandColor … ` par :

```ts
    avatarUrl: text("avatar_url"),
    avatarKind: text("avatar_kind"),
    avatarStyle: text("avatar_style"),
    avatarSeed: text("avatar_seed"),
    bannerUrl: text("banner_url"),
    brandColor: text("brand_color").default("#6366f1").notNull(),
    headerLayout: text("header_layout").default("profil").notNull(),
```

- [ ] **Step 2:** Générer la migration : `pnpm db:generate`
  Expected: un nouveau fichier SQL sous `drizzle/` ajoutant les 5 colonnes.
- [ ] **Step 3:** Appliquer : `pnpm db:migrate`
  Expected: succès (si DB injoignable, noter et continuer — les colonnes existent dans le schéma TS).
- [ ] **Step 4:** `pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit : `git add -A && git commit -m "feat(db): branding columns on professional"`

---

## Task 2: Env — flag Blob

**Files:** Modify `src/lib/env.ts:16-23,56-63`

- [ ] **Step 1:** Ajouter dans le `schema` zod (après `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) :

```ts
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
```

- [ ] **Step 2:** Ajouter dans l'objet `env` (après `RESEND_ENABLED`) :

```ts
  /** Image uploads use Vercel Blob; disabled (mock) until a token is provided. */
  BLOB_ENABLED: !isPlaceholder(raw.BLOB_READ_WRITE_TOKEN),
```

- [ ] **Step 3:** `pnpm typecheck` → PASS.
- [ ] **Step 4:** Commit : `git commit -am "feat(env): BLOB_READ_WRITE_TOKEN + BLOB_ENABLED flag"`

---

## Task 3: `color.ts` (+ vitest)

**Files:** Create `vitest.config.ts`, `src/lib/color.ts`, `src/lib/color.test.ts`; Modify `package.json`

**Interfaces produces:** `brandTheme(hex: string): { primary; primaryForeground; primaryMuted }`, `brandThemeVars(hex: string): React.CSSProperties`.

- [ ] **Step 1:** Installer vitest : `pnpm add -D vitest` puis ajouter le script dans `package.json` (`"test": "vitest run"`).
- [ ] **Step 2:** `vitest.config.ts` :

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 3:** Écrire le test `src/lib/color.test.ts` (échoue d'abord) :

```ts
import { describe, expect, it } from "vitest";
import { brandTheme } from "./color";

describe("brandTheme", () => {
  it("met un texte blanc sur une marque foncée", () => {
    expect(brandTheme("#6d5cf6").primaryForeground).toBe("#ffffff");
  });
  it("met un texte sombre sur une marque claire", () => {
    expect(brandTheme("#facc15").primaryForeground).toBe("#1a1a2e");
    expect(brandTheme("#ffffff").primaryForeground).toBe("#1a1a2e");
  });
  it("met un texte blanc sur du noir", () => {
    expect(brandTheme("#000000").primaryForeground).toBe("#ffffff");
  });
  it("retombe sur la couleur par défaut si hex invalide", () => {
    expect(brandTheme("pas-une-couleur").primary).toBe("#6d5cf6");
  });
  it("produit un muted clair (luminance haute)", () => {
    const m = brandTheme("#6d5cf6").primaryMuted;
    expect(/^#[0-9a-f]{6}$/.test(m)).toBe(true);
    expect(m).not.toBe("#6d5cf6");
  });
});
```

- [ ] **Step 4:** Lancer → FAIL (`brandTheme` non défini) : `pnpm test`
- [ ] **Step 5:** Implémenter `src/lib/color.ts` :

```ts
import type { CSSProperties } from "react";

const FALLBACK = "#6d5cf6";
type RGB = [number, number, number];

export interface BrandTheme {
  primary: string;
  primaryForeground: string;
  primaryMuted: string;
}

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(rgb: RGB): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function mixWhite([r, g, b]: RGB, w: number): RGB {
  return [r + (255 - r) * w, g + (255 - g) * w, b + (255 - b) * w];
}

const DARK_FG: RGB = [26, 26, 46]; // #1a1a2e

export function brandTheme(input: string): BrandTheme {
  const rgb = parseHex(input) ?? (parseHex(FALLBACK) as RGB);
  const lum = luminance(rgb);
  const whiteContrast = contrast(1, lum);
  const darkContrast = contrast(luminance(DARK_FG), lum);
  const primaryForeground = whiteContrast >= darkContrast ? "#ffffff" : "#1a1a2e";
  return {
    primary: toHex(rgb),
    primaryForeground,
    primaryMuted: toHex(mixWhite(rgb, 0.88)),
  };
}

export function brandThemeVars(input: string): CSSProperties {
  const t = brandTheme(input);
  return {
    ["--color-primary" as string]: t.primary,
    ["--color-primary-foreground" as string]: t.primaryForeground,
    ["--color-primary-muted" as string]: t.primaryMuted,
  } as CSSProperties;
}
```

- [ ] **Step 6:** `pnpm test` → PASS. `pnpm typecheck` → PASS.
- [ ] **Step 7:** Commit : `git add -A && git commit -m "feat(branding): brand color theme helper with WCAG contrast"`

---

## Task 4: `avatar.ts` + `BrandAvatar` (+ vitest)

**Files:** Create `src/lib/avatar.ts`, `src/lib/avatar.test.ts`, `src/components/public/brand-avatar.tsx`; Modify `package.json`

**Interfaces consumes:** rien. **produces:** `resolveAvatar(a): {mode:'svg',svg} | {mode:'img',src} | {mode:'initials'}`, `GENERATED_STYLES`, `isGeneratedStyle()`, type `AvatarInput`; composant `BrandAvatar`.

- [ ] **Step 1:** `pnpm add @dicebear/core @dicebear/collection`
- [ ] **Step 2:** Test `src/lib/avatar.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { resolveAvatar } from "./avatar";

describe("resolveAvatar", () => {
  it("rend un SVG pour un avatar généré valide", () => {
    const r = resolveAvatar({ avatarKind: "generated", avatarStyle: "micah", avatarSeed: "x" });
    expect(r.mode).toBe("svg");
    if (r.mode === "svg") expect(r.svg).toContain("<svg");
  });
  it("retombe sur initiales si le style généré est inconnu", () => {
    expect(resolveAvatar({ avatarKind: "generated", avatarStyle: "nope" }).mode).toBe("initials");
  });
  it("utilise l'image pour un pack/upload", () => {
    expect(resolveAvatar({ avatarKind: "pack", avatarUrl: "/a.png" })).toEqual({ mode: "img", src: "/a.png" });
    expect(resolveAvatar({ avatarKind: "upload", avatarUrl: "https://x/y.png" }).mode).toBe("img");
  });
  it("retombe sur initiales sans donnée", () => {
    expect(resolveAvatar({}).mode).toBe("initials");
  });
});
```

- [ ] **Step 3:** `pnpm test` → FAIL.
- [ ] **Step 4:** Implémenter `src/lib/avatar.ts` :

```ts
import { createAvatar } from "@dicebear/core";
import { funEmoji, lorelei, micah, pixelArt } from "@dicebear/collection";

export const GENERATED_STYLES = {
  "fun-emoji": funEmoji,
  micah,
  lorelei,
  "pixel-art": pixelArt,
} as const;

export type GeneratedStyle = keyof typeof GENERATED_STYLES;

export function isGeneratedStyle(s: string | null | undefined): s is GeneratedStyle {
  return !!s && Object.prototype.hasOwnProperty.call(GENERATED_STYLES, s);
}

export interface AvatarInput {
  avatarKind?: string | null;
  avatarStyle?: string | null;
  avatarSeed?: string | null;
  avatarUrl?: string | null;
}

export type ResolvedAvatar =
  | { mode: "svg"; svg: string }
  | { mode: "img"; src: string }
  | { mode: "initials" };

export function resolveAvatar(a: AvatarInput): ResolvedAvatar {
  if (a.avatarKind === "generated" && isGeneratedStyle(a.avatarStyle)) {
    const svg = createAvatar(GENERATED_STYLES[a.avatarStyle], {
      seed: a.avatarSeed ?? "",
      radius: 20,
    }).toString();
    return { mode: "svg", svg };
  }
  if ((a.avatarKind === "pack" || a.avatarKind === "upload") && a.avatarUrl) {
    return { mode: "img", src: a.avatarUrl };
  }
  return { mode: "initials" };
}
```

- [ ] **Step 5:** `pnpm test` → PASS.
- [ ] **Step 6:** Composant `src/components/public/brand-avatar.tsx` :

```tsx
import { cn, initials } from "@/lib/utils";
import { resolveAvatar, type AvatarInput } from "@/lib/avatar";

export function BrandAvatar({
  name,
  className,
  ...avatar
}: AvatarInput & { name: string; className?: string }) {
  const r = resolveAvatar(avatar);
  const base =
    "grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-card [&>svg]:size-full";

  if (r.mode === "svg") {
    return (
      <span
        className={cn(base, className)}
        role="img"
        aria-label={name}
        dangerouslySetInnerHTML={{ __html: r.svg }}
      />
    );
  }
  if (r.mode === "img") {
    return (
      <span className={cn(base, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.src} alt={name} className="size-full object-cover" />
      </span>
    );
  }
  return (
    <span
      className={cn(base, "bg-accent font-semibold text-accent-foreground", className)}
    >
      {initials(name)}
    </span>
  );
}
```

- [ ] **Step 7:** `pnpm typecheck` → PASS.
- [ ] **Step 8:** Commit : `git add -A && git commit -m "feat(branding): avatar resolution + BrandAvatar component"`

---

## Task 5: Pack 3D (assets + manifeste)

**Files:** Create `scripts/fetch-avatar-pack.ts`, `src/lib/avatar-pack.ts`, `public/avatars/3d/LICENSE.md`

**Note licence (bloquant) :** Microsoft Fluent Emoji = **MIT** (`github.com/microsoft/fluentui-emoji`). On embarque les PNG « 3D » de personnages/visages.

- [ ] **Step 1:** Vérifier le pattern d'URL raw d'un asset 3D, ex. :
  `https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Artist/3D/artist_3d.png`
  via `curl -sI <url>` → `200`. Si 404, lister `assets/` via l'API GitHub (`https://api.github.com/repos/microsoft/fluentui-emoji/contents/assets`) et corriger les chemins.
- [ ] **Step 2:** `src/lib/avatar-pack.ts` — manifeste (data pure, importable client) :

```ts
// id = nom de fichier local sous public/avatars/3d/
export interface PackAvatar { id: string; alt: string }
export const AVATAR_PACK: PackAvatar[] = [
  { id: "artist", alt: "Artiste" },
  { id: "health-worker", alt: "Soignant" },
  { id: "teacher", alt: "Enseignant" },
  { id: "cook", alt: "Cuisinier" },
  { id: "mechanic", alt: "Mécanicien" },
  { id: "office-worker", alt: "Employé de bureau" },
  { id: "scientist", alt: "Scientifique" },
  { id: "student", alt: "Étudiant" },
  { id: "technologist", alt: "Technicien" },
  { id: "farmer", alt: "Agriculteur" },
  { id: "singer", alt: "Chanteur" },
  { id: "judge", alt: "Juge" },
  { id: "pilot", alt: "Pilote" },
  { id: "astronaut", alt: "Astronaute" },
  { id: "firefighter", alt: "Pompier" },
  { id: "detective", alt: "Détective" },
  { id: "guard", alt: "Agent" },
  { id: "ninja", alt: "Ninja" },
  { id: "supervillain", alt: "Super-vilain" },
  { id: "superhero", alt: "Super-héros" },
  { id: "mage", alt: "Mage" },
  { id: "fairy", alt: "Fée" },
  { id: "elf", alt: "Elfe" },
  { id: "mermaid", alt: "Sirène" },
];
export function packSrc(id: string): string {
  return `/avatars/3d/${id}.png`;
}
```

- [ ] **Step 3:** `scripts/fetch-avatar-pack.ts` — télécharge chaque entrée (mapping id → chemin Fluent) dans `public/avatars/3d/{id}.png`. Mapping `id → "<Folder>/3D/<snake>_3d.png"` (ex. `artist → "Artist/3D/artist_3d.png"`, `health-worker → "Health worker/3D/health_worker_3d.png"`). Le script log un avertissement et continue sur 404 (jamais de silence sur un asset manquant).

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { AVATAR_PACK } from "../src/lib/avatar-pack";

const BASE = "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets";
// id -> dossier Fluent (Title Case). Le fichier = <snake>_3d.png
const FOLDER: Record<string, string> = {
  artist: "Artist", "health-worker": "Health worker", teacher: "Teacher",
  cook: "Cook", mechanic: "Mechanic", "office-worker": "Office worker",
  scientist: "Scientist", student: "Student", technologist: "Technologist",
  farmer: "Farmer", singer: "Singer", judge: "Judge", pilot: "Pilot",
  astronaut: "Astronaut", firefighter: "Firefighter", detective: "Detective",
  guard: "Guard", ninja: "Ninja", supervillain: "Supervillain",
  superhero: "Superhero", mage: "Mage", fairy: "Fairy", elf: "Elf",
  mermaid: "Mermaid",
};

const out = "public/avatars/3d";
await mkdir(out, { recursive: true });
let ok = 0, miss: string[] = [];
for (const { id } of AVATAR_PACK) {
  const folder = FOLDER[id];
  const snake = folder.toLowerCase().replace(/ /g, "_");
  const url = `${BASE}/${encodeURIComponent(folder)}/3D/${snake}_3d.png`;
  const res = await fetch(url);
  if (!res.ok) { miss.push(`${id} (${res.status}) ${url}`); continue; }
  await writeFile(`${out}/${id}.png`, Buffer.from(await res.arrayBuffer()));
  ok++;
}
console.log(`✅ ${ok} avatars téléchargés`);
if (miss.length) console.warn(`⚠️  manquants:\n${miss.join("\n")}`);
```

- [ ] **Step 4:** Lancer : `pnpm tsx scripts/fetch-avatar-pack.ts`
  Expected: ~24 PNG dans `public/avatars/3d/`. **Corriger le mapping `FOLDER` pour tout manquant** (re-vérifier le nom de dossier sur le repo), relancer jusqu'à 0 manquant. Si certains personnages n'existent pas en 3D, les retirer du manifeste `AVATAR_PACK`.
- [ ] **Step 5:** `public/avatars/3d/LICENSE.md` :

```md
# Pack d'avatars 3D

Source : Microsoft Fluent Emoji — https://github.com/microsoft/fluentui-emoji
Licence : MIT (© Microsoft). Voir le dépôt pour le texte complet.
Seuls les rendus « 3D » de personnages sont inclus, renommés pour Skedul.
```

- [ ] **Step 6:** Commit : `git add -A && git commit -m "feat(branding): bundle MIT 3D avatar pack (Fluent Emoji)"`

---

## Task 6: PublicShell — bannière + layout + theming

**Files:** Modify `src/components/public/public-shell.tsx`, `src/app/[slug]/page.tsx:34-39`, `src/app/[slug]/book/[eventTypeId]/page.tsx`, `src/app/[slug]/pack/[packId]/page.tsx`, `src/app/[slug]/merci/page.tsx`

**Interfaces consumes:** `brandThemeVars` (Task 3), `BrandAvatar` (Task 4).

- [ ] **Step 1:** Réécrire `src/components/public/public-shell.tsx` :

```tsx
import Link from "next/link";

import { BrandAvatar } from "@/components/public/brand-avatar";
import { Logo } from "@/components/ui/logo";
import { brandThemeVars } from "@/lib/color";
import { cn } from "@/lib/utils";

export function PublicShell({
  businessName,
  headline,
  brandColor,
  bannerUrl,
  headerLayout = "profil",
  avatarKind,
  avatarStyle,
  avatarSeed,
  avatarUrl,
  backHref,
  children,
}: {
  businessName: string;
  headline?: string | null;
  brandColor: string;
  bannerUrl?: string | null;
  headerLayout?: string | null;
  avatarKind?: string | null;
  avatarStyle?: string | null;
  avatarSeed?: string | null;
  avatarUrl?: string | null;
  backHref?: string;
  children: React.ReactNode;
}) {
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
            style={{ background: `linear-gradient(180deg, ${brandColor}22, transparent)` }}
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
```

- [ ] **Step 2:** Dans `src/app/[slug]/page.tsx`, remplacer les props du `<PublicShell>` (lignes 34-39) par :

```tsx
    <PublicShell
      businessName={pro.businessName}
      headline={pro.headline}
      brandColor={pro.brandColor}
      bannerUrl={pro.bannerUrl}
      headerLayout={pro.headerLayout}
      avatarKind={pro.avatarKind}
      avatarStyle={pro.avatarStyle}
      avatarSeed={pro.avatarSeed}
      avatarUrl={pro.avatarUrl}
    >
```

- [ ] **Step 3:** Dans `book/[eventTypeId]/page.tsx`, `pack/[packId]/page.tsx`, `merci/page.tsx` : pour chaque `<PublicShell …>`, ajouter les mêmes props branding depuis l'objet `professional` disponible (remplacer un éventuel `avatarUrl={…}` seul). Le nom de la variable pro peut différer (`pro`, `data.professional`, `professional`) — adapter. Conserver `backHref`.
- [ ] **Step 4:** `pnpm typecheck` → PASS, puis `pnpm build` → PASS.
- [ ] **Step 5:** Commit : `git add -A && git commit -m "feat(branding): banner, layout & brand theming on public shell"`

---

## Task 7: Route d'upload (Vercel Blob)

**Files:** Create `src/app/api/upload/route.ts`

**Interfaces consumes:** `env.BLOB_ENABLED`, `env.BLOB_READ_WRITE_TOKEN` (Task 2). **produces:** `POST /api/upload` (FormData `file`, `kind`) → `{ url }`.

- [ ] **Step 1:** `pnpm add @vercel/blob`
- [ ] **Step 2:** Créer le fichier :

```ts
import { put } from "@vercel/blob";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getCurrentProfessional } from "@/lib/session";

const MAX: Record<"banner" | "avatar", number> = { banner: 5_000_000, avatar: 2_000_000 };
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(req: Request) {
  if (!env.BLOB_ENABLED) {
    return NextResponse.json({ error: "Stockage non configuré" }, { status: 503 });
  }
  const pro = await getCurrentProfessional();
  if (!pro) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const kind = form.get("kind") === "banner" ? "banner" : "avatar";
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }
  if (!TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Format non supporté (jpeg, png, webp)" }, { status: 415 });
  }
  if (file.size > MAX[kind]) {
    return NextResponse.json({ error: "Fichier trop volumineux" }, { status: 413 });
  }
  const ext = file.type.split("/")[1];
  const blob = await put(`branding/${pro.id}/${kind}-${nanoid()}.${ext}`, file, {
    access: "public",
    token: env.BLOB_READ_WRITE_TOKEN,
  });
  return NextResponse.json({ url: blob.url });
}
```

- [ ] **Step 3:** `pnpm typecheck` → PASS.
- [ ] **Step 4:** Commit : `git add -A && git commit -m "feat(branding): Vercel Blob upload route"`

---

## Task 8: Action `updateBranding`

**Files:** Modify `src/server/pro.ts` (après `updateProfile`, ~ligne 106)

**Interfaces produces:** `updateBranding(input)` server action.

- [ ] **Step 1:** Ajouter :

```ts
export async function updateBranding(input: {
  brandColor?: string;
  bannerUrl?: string | null;
  headerLayout?: string;
  avatarKind?: string | null;
  avatarStyle?: string | null;
  avatarSeed?: string | null;
  avatarUrl?: string | null;
}) {
  const pro = await requirePro();
  const layout = input.headerLayout === "vitrine" ? "vitrine" : "profil";
  const kind =
    input.avatarKind === "generated" ||
    input.avatarKind === "pack" ||
    input.avatarKind === "upload"
      ? input.avatarKind
      : null;
  await db
    .update(professional)
    .set({
      brandColor: input.brandColor || pro.brandColor,
      bannerUrl: input.bannerUrl ?? null,
      headerLayout: layout,
      avatarKind: kind,
      avatarStyle: kind === "generated" ? (input.avatarStyle ?? null) : null,
      avatarSeed: kind === "generated" ? (input.avatarSeed ?? null) : null,
      avatarUrl: kind === "pack" || kind === "upload" ? (input.avatarUrl ?? null) : null,
    })
    .where(eq(professional.id, pro.id));
  revalidatePath("/dashboard/settings");
  revalidatePath(`/${pro.slug}`);
}
```

- [ ] **Step 2:** `pnpm typecheck` → PASS.
- [ ] **Step 3:** Commit : `git add -A && git commit -m "feat(branding): updateBranding server action"`

---

## Task 9: BrandingForm + page réglages

**Files:** Create `src/components/dashboard/branding-form.tsx`; Modify `src/components/dashboard/profile-form.tsx:23-100`, `src/app/dashboard/settings/page.tsx`

**Interfaces consumes:** `updateBranding` (Task 8), `AVATAR_PACK`/`packSrc` (Task 5), `GENERATED_STYLES` keys (Task 4), `/api/upload` (Task 7).

- [ ] **Step 1:** Retirer la couleur de `ProfileForm` : supprimer le `<div>` `brandColor` (lignes ~76-85), retirer `brandColor` de `ProfileValues` et de l'appel `updateProfile` (laisser `updateProfile` tel quel — `brandColor` y est optionnel). La grille restante n'a plus que `timezone` : remplacer `grid grid-cols-2` par un simple bloc.
- [ ] **Step 2:** Créer `src/components/dashboard/branding-form.tsx` :

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Loader2, Upload } from "lucide-react";

import { updateBranding } from "@/server/pro";
import { AVATAR_PACK, packSrc } from "@/lib/avatar-pack";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const STYLES = ["fun-emoji", "micah", "lorelei", "pixel-art"] as const;
const PREVIEW = (style: string, seed: string) =>
  `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;

export interface BrandingValues {
  brandColor: string;
  bannerUrl: string | null;
  headerLayout: string;
  avatarKind: string | null;
  avatarStyle: string | null;
  avatarSeed: string | null;
  avatarUrl: string | null;
}

type Tab = "gallery" | "pack" | "upload";

export function BrandingForm({
  values,
  businessName,
  blobEnabled,
}: {
  values: BrandingValues;
  businessName: string;
  blobEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const [brandColor, setBrandColor] = useState(values.brandColor);
  const [layout, setLayout] = useState(values.headerLayout || "profil");
  const [banner, setBanner] = useState<string | null>(values.bannerUrl);
  const [avatar, setAvatar] = useState({
    kind: values.avatarKind,
    style: values.avatarStyle,
    seed: values.avatarSeed,
    url: values.avatarUrl,
  });
  const [tab, setTab] = useState<Tab>(
    values.avatarKind === "pack" ? "pack" : values.avatarKind === "upload" ? "upload" : "gallery",
  );
  // graines de prévisualisation pour la galerie
  const [seeds, setSeeds] = useState(() =>
    Array.from({ length: 6 }, (_, i) => `${businessName || "skedul"}-${i}`),
  );
  const [error, setError] = useState<string | null>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  async function upload(file: File, kind: "banner" | "avatar"): Promise<string | null> {
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? "Upload échoué");
      return null;
    }
    return (await res.json()).url as string;
  }

  function save() {
    startTransition(async () => {
      await updateBranding({
        brandColor,
        bannerUrl: banner,
        headerLayout: layout,
        avatarKind: avatar.kind,
        avatarStyle: avatar.style,
        avatarSeed: avatar.seed,
        avatarUrl: avatar.url,
      });
      setSaved(true);
      router.refresh();
    });
  }

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium",
        tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Bannière */}
      <div className="space-y-2">
        <Label>Bannière</Label>
        <div
          className="relative h-28 overflow-hidden rounded-xl border border-border bg-muted"
          style={!banner ? { background: `linear-gradient(180deg, ${brandColor}22, #fff)` } : undefined}
        >
          {banner && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={banner} alt="" className="size-full object-cover" />
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!blobEnabled || pending}
            onClick={() => bannerInput.current?.click()}
          >
            <Upload className="size-4" /> {banner ? "Changer" : "Ajouter"}
          </Button>
          {banner && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setBanner(null)}>
              Retirer
            </Button>
          )}
          <input
            ref={bannerInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                const url = await upload(f, "banner");
                if (url) setBanner(url);
              }
              e.target.value = "";
            }}
          />
        </div>
        {!blobEnabled && (
          <p className="text-xs text-muted-foreground">
            Upload indisponible (stockage non configuré). La galerie et le pack 3D restent disponibles.
          </p>
        )}
      </div>

      {/* Avatar */}
      <div className="space-y-2">
        <Label>Avatar</Label>
        <div className="flex gap-1 rounded-xl bg-card p-1">
          {tabBtn("gallery", "Galerie")}
          {tabBtn("pack", "3D")}
          {tabBtn("upload", "Upload")}
        </div>

        {tab === "gallery" && (
          <div className="space-y-4">
            {STYLES.map((style) => (
              <div key={style}>
                <p className="mb-1 text-xs capitalize text-muted-foreground">{style.replace("-", " ")}</p>
                <div className="flex flex-wrap gap-2">
                  {seeds.map((seed) => {
                    const active =
                      avatar.kind === "generated" && avatar.style === style && avatar.seed === seed;
                    return (
                      <button
                        key={seed}
                        type="button"
                        onClick={() => setAvatar({ kind: "generated", style, seed, url: null })}
                        className={cn(
                          "size-12 overflow-hidden rounded-xl border-2 bg-card",
                          active ? "border-primary" : "border-transparent hover:border-border",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={PREVIEW(style, seed)} alt="" className="size-full" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setSeeds(Array.from({ length: 6 }, () => Math.random().toString(36).slice(2, 9)))
              }
            >
              Régénérer
            </Button>
          </div>
        )}

        {tab === "pack" && (
          <div className="flex flex-wrap gap-2">
            {AVATAR_PACK.map((a) => {
              const url = packSrc(a.id);
              const active = avatar.kind === "pack" && avatar.url === url;
              return (
                <button
                  key={a.id}
                  type="button"
                  title={a.alt}
                  onClick={() => setAvatar({ kind: "pack", style: null, seed: null, url })}
                  className={cn(
                    "size-14 overflow-hidden rounded-xl border-2 bg-card p-1",
                    active ? "border-primary" : "border-transparent hover:border-border",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={a.alt} className="size-full object-contain" />
                </button>
              );
            })}
          </div>
        )}

        {tab === "upload" && (
          <div className="space-y-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!blobEnabled || pending}
              onClick={() => avatarInput.current?.click()}
            >
              <Upload className="size-4" /> Choisir une image
            </Button>
            {avatar.kind === "upload" && avatar.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar.url} alt="" className="size-16 rounded-xl object-cover" />
            )}
            <input
              ref={avatarInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const url = await upload(f, "avatar");
                  if (url) setAvatar({ kind: "upload", style: null, seed: null, url });
                }
                e.target.value = "";
              }}
            />
            {!blobEnabled && (
              <p className="text-xs text-muted-foreground">Upload indisponible (stockage non configuré).</p>
            )}
          </div>
        )}
      </div>

      {/* Couleur + layout */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="brandColor">Couleur de marque</Label>
          <input
            id="brandColor"
            type="color"
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-xl border border-input bg-card p-1"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Mise en page</Label>
          <div className="flex gap-2">
            {(["profil", "vitrine"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLayout(l)}
                className={cn(
                  "flex-1 rounded-xl border px-3 py-2 text-sm capitalize",
                  layout === l ? "border-primary bg-primary-muted text-primary" : "border-input",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-3 pt-1">
        <Button type="button" onClick={save} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Enregistrer
        </Button>
        {saved && <span className="text-sm text-success">Enregistré ✓</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3:** Dans `src/app/dashboard/settings/page.tsx`, importer `BrandingForm` et `env`, et ajouter une carte « Identité visuelle » après la carte « Profil public » :

```tsx
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Identité visuelle</CardTitle>
          <p className="text-sm text-muted-foreground">
            Bannière, avatar, couleur et mise en page de votre page publique.
          </p>
        </CardHeader>
        <CardContent>
          <BrandingForm
            businessName={pro.businessName}
            blobEnabled={env.BLOB_ENABLED}
            values={{
              brandColor: pro.brandColor,
              bannerUrl: pro.bannerUrl,
              headerLayout: pro.headerLayout,
              avatarKind: pro.avatarKind,
              avatarStyle: pro.avatarStyle,
              avatarSeed: pro.avatarSeed,
              avatarUrl: pro.avatarUrl,
            }}
          />
        </CardContent>
      </Card>
```

  (et retirer `brandColor` de l'objet passé à `ProfileForm`.)
- [ ] **Step 4:** `pnpm typecheck` → PASS, `pnpm build` → PASS.
- [ ] **Step 5:** Commit : `git add -A && git commit -m "feat(branding): back-office branding form (banner, avatar picker, color, layout)"`

---

## Task 10: Vérification finale + seed démo

**Files:** Modify `scripts/seed.ts` (optionnel : donner un branding au pro démo)

- [ ] **Step 1:** (Optionnel) Dans le seed, donner au pro `studio-camille` un avatar généré (`avatarKind:"generated", avatarStyle:"micah", avatarSeed:"camille"`) et `headerLayout:"vitrine"` pour la démo.
- [ ] **Step 2:** `pnpm test` → PASS, `pnpm typecheck` → PASS, `pnpm build` → PASS.
- [ ] **Step 3:** Smoke manuel (`pnpm dev`) : régler chaque source d'avatar + bannière + couleur claire (vérifier contraste boutons) + layout, puis ouvrir `/studio-camille` et un `/…/book/…` → branding cohérent.
- [ ] **Step 4:** Commit final si changement : `git add -A && git commit -m "chore(branding): demo branding in seed"`

---

## Self-review (couverture du spec)

- Avatar galerie 4 styles → Task 4 (`GENERATED_STYLES`) + Task 9 (picker). ✓
- Pack 3D → Task 5 + Task 9 (onglet 3D). ✓
- Upload avatar + bannière → Task 7 (route) + Task 9 (UI) ; mode mock → flag `blobEnabled`. ✓
- Couleur → boutons/accents → Task 3 + Task 6 (`brandThemeVars` sur le shell). ✓
- Bannière + fallback dégradé → Task 6. ✓
- Layout Profil/Vitrine au choix du pro → Task 6 (rendu) + Task 9 (réglage) + `headerLayout` (Task 1). ✓
- Périmètre = toutes les pages publiques → Task 6 (4 call sites). ✓
- Stockage Blob + flag → Task 2 + Task 7. ✓
- Build vert sans secret → uploads gardés derrière `BLOB_ENABLED`, avatars générés/pack sans réseau au build. ✓
