"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { MAX_ATTACHMENTS, MAX_SOURCE_IMAGE_BYTES, checkAttachments } from "@/lib/support";
import { shrinkImage } from "@/lib/shrink-image";
import { cn } from "@/lib/utils";

export type PickedImage = { file: File; url: string };

/**
 * Picks up to 3 screenshots with previews; heavy ones are shrunk in the
 * browser first (Vercel caps request bodies at 4.5 MB). The parent owns the
 * list and sends the files; previews are revoked when removed or sent (any
 * left are freed by the browser when the page unloads).
 */
export function ImageAttachInput({
  images,
  onChange,
  disabled = false,
  compact = false,
}: {
  images: PickedImage[];
  onChange: (images: PickedImage[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the list may change (sent, removed) while images are being shrunk
  const latest = useRef(images);
  useEffect(() => {
    latest.current = images;
  }, [images]);
  const tile = compact ? "size-14" : "size-20";

  async function add(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;
    if (images.length + picked.length > MAX_ATTACHMENTS) {
      setError(`${MAX_ATTACHMENTS} images maximum par message.`);
      return;
    }
    for (const file of picked) {
      if (!file.type.startsWith("image/")) {
        setError("Format d’image non pris en charge (png, jpg ou webp).");
        return;
      }
      if (file.size > MAX_SOURCE_IMAGE_BYTES) {
        setError(`Image trop lourde (${MAX_SOURCE_IMAGE_BYTES / 1_000_000} Mo maximum).`);
        return;
      }
    }
    setError(null);
    setBusy(true);
    try {
      const shrunk: File[] = [];
      // one at a time: each decoded bitmap can weigh hundreds of MB
      for (const file of picked) shrunk.push(await shrinkImage(file));
      const current = latest.current;
      const check = checkAttachments([...current.map((i) => i.file), ...shrunk]);
      if (!check.ok) {
        setError(check.error);
        return;
      }
      onChange([...current, ...shrunk.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de lire cette image.");
    } finally {
      setBusy(false);
    }
  }

  function remove(index: number) {
    URL.revokeObjectURL(images[index].url);
    setError(null);
    onChange(images.filter((_, i) => i !== index));
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {images.map((image, i) => (
          <div
            key={image.url}
            className={cn("relative overflow-hidden rounded-xl border border-border bg-muted", tile)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview */}
            <img src={image.url} alt={`Capture d’écran ${i + 1}`} className="size-full object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={disabled}
              aria-label={`Retirer la capture d’écran ${i + 1}`}
              className="absolute right-1 top-1 rounded-full bg-foreground/70 p-0.5 text-white transition-colors hover:bg-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {images.length < MAX_ATTACHMENTS && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
            aria-busy={busy}
            aria-label={busy ? "Préparation de l’image" : "Ajouter une capture d’écran"}
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50",
              tile,
            )}
          >
            {busy ? (
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-4" aria-hidden />
            )}
            {!compact && "Ajouter"}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => void add(e.target.files)}
      />
      {(error || !compact) && (
        <p
          role={error ? "alert" : undefined}
          className={cn("mt-2 text-xs", error ? "text-destructive" : "text-muted-foreground")}
        >
          {error ??
            `Jusqu’à ${MAX_ATTACHMENTS} captures d’écran (png, jpg ou webp). Les images lourdes sont réduites automatiquement.`}
        </p>
      )}
    </div>
  );
}
