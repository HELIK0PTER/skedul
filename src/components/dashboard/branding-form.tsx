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
const preview = (style: string, seed: string) =>
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

interface AvatarState {
  kind: string | null;
  style: string | null;
  seed: string | null;
  url: string | null;
}

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

  async function upload(file: File, kind: "banner" | "avatar"): Promise<string | null> {
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Upload échoué");
      return null;
    }
    const body = (await res.json()) as { url: string };
    return body.url;
  }

  function save() {
    setSaved(false);
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
      {/* Bannière */}
      <div className="space-y-2">
        <Label>Bannière</Label>
        <div
          className="relative h-28 overflow-hidden rounded-xl border border-border bg-muted"
          style={
            !banner
              ? { background: `linear-gradient(180deg, ${brandColor}22, #fff)` }
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

      {/* Couleur + mise en page */}
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
