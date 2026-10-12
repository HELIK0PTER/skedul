"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Upload } from "lucide-react";

import { updateBranding } from "@/server/pro";
import { AVATAR_PACK, packSrc } from "@/lib/avatar-pack";
import { uploadErrorMessage, type BrandingKind } from "@/lib/branding-upload";
import { shrinkImage } from "@/lib/shrink-image";
import { MAX_SOURCE_IMAGE_BYTES } from "@/lib/support";
import { THEME_PRESETS, brandThemeVars, presetColor } from "@/lib/color";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn, initials } from "@/lib/utils";

const STYLES = ["fun-emoji", "micah", "lorelei", "pixel-art"] as const;
const preview = (style: string, seed: string) =>
  `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;

export interface BrandingValues {
  themePreset: string;
  customColor: string | null;
  bannerUrl: string | null;
  headerLayout: string;
  avatarKind: string | null;
  avatarStyle: string | null;
  avatarSeed: string | null;
  avatarUrl: string | null;
}

type Tab = "gallery" | "pack" | "upload";

interface AvatarState {
  kind: string | null;
  style: string | null;
  seed: string | null;
  url: string | null;
}

export function BrandingForm({
  values,
  businessName,
  headline,
  blobEnabled,
}: {
  values: BrandingValues;
  businessName: string;
  headline?: string | null;
  blobEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const [themePreset, setThemePreset] = useState(values.themePreset || "violet");
  const [customColor, setCustomColor] = useState(values.customColor || "#6d5cf6");
  const activeColor =
    themePreset === "custom" ? customColor : (presetColor(themePreset) ?? "#6d5cf6");
  const [layout, setLayout] = useState(values.headerLayout || "profil");
  const [banner, setBanner] = useState<string | null>(values.bannerUrl);
  const [avatar, setAvatar] = useState<AvatarState>({
    kind: values.avatarKind,
    style: values.avatarStyle,
    seed: values.avatarSeed,
    url: values.avatarUrl,
  });
  const [tab, setTab] = useState<Tab>(
    values.avatarKind === "pack"
      ? "pack"
      : values.avatarKind === "upload"
        ? "upload"
        : "gallery",
  );
  const [seeds, setSeeds] = useState<string[]>(() =>
    Array.from({ length: 6 }, (_, i) => `${businessName || "skedul"}-${i}`),
  );
  const [error, setError] = useState<string | null>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  // Lift the preview panel with a shadow once it is stuck. The panel starts
  // 12px above its sentinel (md:-m-3) and sticks at md:top-4 (16px), so it is
  // stuck once the sentinel has passed 28px.
  const stickSentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = stickSentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 28),
      { rootMargin: "-28px 0px 0px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const centered = layout === "vitrine";

  // Detect unsaved edits by comparing the live state to the saved values.
  const dirty =
    JSON.stringify({
      themePreset,
      customColor,
      banner,
      layout,
      ...avatar,
    }) !==
    JSON.stringify({
      themePreset: values.themePreset || "violet",
      customColor: values.customColor || "#6d5cf6",
      banner: values.bannerUrl,
      layout: values.headerLayout || "profil",
      kind: values.avatarKind,
      style: values.avatarStyle,
      seed: values.avatarSeed,
      url: values.avatarUrl,
    });

  function reset() {
    setThemePreset(values.themePreset || "violet");
    setCustomColor(values.customColor || "#6d5cf6");
    setBanner(values.bannerUrl);
    setLayout(values.headerLayout || "profil");
    setAvatar({
      kind: values.avatarKind,
      style: values.avatarStyle,
      seed: values.avatarSeed,
      url: values.avatarUrl,
    });
    setTab(
      values.avatarKind === "pack"
        ? "pack"
        : values.avatarKind === "upload"
          ? "upload"
          : "gallery",
    );
    setError(null);
    setSaved(false);
  }

  function previewAvatar() {
    if (avatar.kind === "generated" && avatar.style && avatar.seed) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={preview(avatar.style, avatar.seed)} alt="" className="size-full" />;
    }
    if ((avatar.kind === "pack" || avatar.kind === "upload") && avatar.url) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={avatar.url} alt="" className="size-full object-cover" />;
    }
    return (
      <span className="grid size-full place-items-center bg-accent text-sm font-semibold text-accent-foreground">
        {initials(businessName)}
      </span>
    );
  }

  async function upload(file: File, kind: BrandingKind): Promise<string | null> {
    setError(null);
    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      setError("Image trop lourde (20 Mo maximum).");
      return null;
    }
    // Vercel refuses request bodies over 4.5 MB: large photos are shrunk
    // (2000 px, WebP) in the browser before they are sent.
    let ready: File;
    try {
      ready = await shrinkImage(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de lire cette image.");
      return null;
    }
    const fd = new FormData();
    fd.set("file", ready);
    fd.set("kind", kind);
    let res: Response;
    try {
      res = await fetch("/api/upload", { method: "POST", body: fd });
    } catch {
      setError("Connexion perdue. Réessayez.");
      return null;
    }
    if (!res.ok) {
      setError(uploadErrorMessage(res.status, await res.json().catch(() => null)));
      return null;
    }
    const body = (await res.json()) as { url: string };
    return body.url;
  }

  function save() {
    setSaved(false);
    startTransition(async () => {
      await updateBranding({
        themePreset,
        customColor,
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
        "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        tab === t
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* The preview and its title float at the top of the screen (md+) while
          the fields below scroll, and stop with this wrapper, above the save
          buttons. -m-3 p-3: an opaque panel the fields slide under, with no
          layout shift. */}
      <div>
        <div ref={stickSentinel} aria-hidden className="h-px -mb-px" />
        <div
          className={cn(
            "relative z-10 rounded-3xl bg-card transition-shadow duration-200 motion-reduce:transition-none md:sticky md:top-4 md:-m-3 md:p-3",
            stuck && "md:shadow-(--shadow-pop) md:ring-1 md:ring-border",
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <Label>Aperçu en direct</Label>
            {dirty && (
              <span className="text-xs font-medium text-warning">
                Modifications non enregistrées
              </span>
            )}
          </div>
          <div
            className="overflow-hidden rounded-xl border border-border bg-card"
            style={brandThemeVars(activeColor)}
          >
            {banner ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={banner} alt="" className="h-24 w-full object-cover" />
            ) : (
              <div
                className="h-16"
                style={{ background: `linear-gradient(180deg, ${activeColor}33, transparent)` }}
              />
            )}
            <div className={cn("px-4 pb-4", centered && "text-center")}>
              <div
                className={cn(
                  "-mt-7 flex gap-3",
                  centered ? "flex-col items-center" : "items-end",
                )}
              >
                <span className="size-14 shrink-0 overflow-hidden rounded-2xl border-4 border-card bg-card shadow-sm [&>svg]:size-full">
                  {previewAvatar()}
                </span>
                <div className={cn("min-w-0", centered ? "" : "pb-1")}>
                  <p className="truncate text-sm font-bold">{businessName}</p>
                  {headline && (
                    <p className="truncate text-xs text-muted-foreground">{headline}</p>
                  )}
                </div>
              </div>
              <div
                className={cn(
                  "mt-3 flex flex-wrap items-center gap-2",
                  centered && "justify-center",
                )}
              >
                <span className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground">
                  Réserver
                </span>
                <span className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-medium text-accent-foreground">
                  Pack 5 séances
                </span>
                <span className="text-xs font-semibold text-primary">En savoir plus</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          {/* Bannière */}
          <div className="space-y-2">
            <Label>Bannière</Label>
            <div
              className="relative h-28 overflow-hidden rounded-xl border border-border bg-muted"
              style={
                !banner
                  ? { background: `linear-gradient(180deg, ${activeColor}22, #fff)` }
                  : undefined
              }
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
                Upload indisponible (stockage non configuré). La galerie et le pack 3D
                restent disponibles.
              </p>
            )}
          </div>

          {/* Avatar */}
          <div className="space-y-2">
            <Label>Avatar</Label>
            <div className="flex w-fit gap-1 rounded-xl bg-card p-1">
              {tabBtn("gallery", "Galerie")}
              {tabBtn("pack", "3D")}
              {tabBtn("upload", "Upload")}
            </div>

            {tab === "gallery" && (
              <div className="space-y-4">
                {STYLES.map((style) => (
                  <div key={style}>
                    <p className="mb-1 text-xs capitalize text-muted-foreground">
                      {style.replace("-", " ")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {seeds.map((seed) => {
                        const active =
                          avatar.kind === "generated" &&
                          avatar.style === style &&
                          avatar.seed === seed;
                        return (
                          <button
                            key={seed}
                            type="button"
                            onClick={() =>
                              setAvatar({ kind: "generated", style, seed, url: null })
                            }
                            className={cn(
                              "size-12 overflow-hidden rounded-xl border-2 bg-card",
                              active ? "border-primary" : "border-transparent hover:border-border",
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={preview(style, seed)} alt="" className="size-full" />
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
                    setSeeds(
                      Array.from({ length: 6 }, () => Math.random().toString(36).slice(2, 9)),
                    )
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
                      onClick={() =>
                        setAvatar({ kind: "pack", style: null, seed: null, url })
                      }
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
                  <p className="text-xs text-muted-foreground">
                    Upload indisponible (stockage non configuré).
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Thème couleur : presets + preset personnalisé */}
          <div className="space-y-2">
            <Label>Thème couleur</Label>
            <p className="text-xs text-muted-foreground">
              Teinte boutons, liens, badges et accents de votre page publique.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {THEME_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.label}
                  aria-label={p.label}
                  onClick={() => setThemePreset(p.id)}
                  className={cn(
                    "size-9 rounded-full border-2 transition-transform",
                    themePreset === p.id
                      ? "scale-110 border-foreground"
                      : "border-transparent hover:scale-105",
                  )}
                  style={{ backgroundColor: p.color }}
                />
              ))}
              <button
                type="button"
                title="Couleur personnalisée"
                aria-label="Couleur personnalisée"
                onClick={() => setThemePreset("custom")}
                className={cn(
                  "size-9 rounded-full border-2 transition-transform",
                  themePreset === "custom"
                    ? "scale-110 border-foreground"
                    : "border-input hover:scale-105",
                )}
                style={
                  themePreset === "custom"
                    ? { backgroundColor: customColor }
                    : {
                        background:
                          "conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)",
                      }
                }
              />
            </div>
            {themePreset === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Couleur personnalisée"
                  value={customColor}
                  onChange={(e) => setCustomColor(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded-xl border border-input bg-card p-1"
                />
                <span className="text-xs text-muted-foreground">
                  Votre preset personnalisé — modifiable à volonté.
                </span>
              </div>
            )}
          </div>

          {/* Mise en page */}
          <div className="space-y-1.5">
            <Label>Mise en page</Label>
            <div className="flex max-w-xs gap-2">
              {(["profil", "vitrine"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLayout(l)}
                  className={cn(
                    "flex-1 rounded-xl border px-3 py-2 text-sm capitalize transition-colors",
                    layout === l
                      ? "border-primary bg-primary-muted text-primary"
                      : "border-input hover:bg-muted",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-3 pt-1">
        <Button type="button" onClick={save} disabled={pending || !dirty}>
          {pending && <Loader2 className="size-4 animate-spin" />} Enregistrer
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={reset}
          disabled={pending || !dirty}
        >
          Annuler
        </Button>
        {saved && !dirty && <span className="text-sm text-success">Enregistré ✓</span>}
      </div>
    </div>
  );
}
