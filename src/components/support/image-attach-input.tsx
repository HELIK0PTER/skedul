"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";

import { MAX_ATTACHMENTS, checkAttachments } from "@/lib/support";
import { cn } from "@/lib/utils";

export type PickedImage = { file: File; url: string };

/**
 * Picks up to 3 screenshots with previews. The parent owns the list and sends
 * the files; previews are revoked when removed or sent (any left are freed by
 * the browser when the page unloads).
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
  const tile = compact ? "size-14" : "size-20";

  function add(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;
    const check = checkAttachments([...images.map((i) => i.file), ...picked]);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    onChange([...images, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
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
            disabled={disabled}
            aria-label="Ajouter une capture d’écran"
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50",
              tile,
            )}
          >
            <ImagePlus className="size-4" aria-hidden />
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
        onChange={(e) => add(e.target.files)}
      />
      {(error || !compact) && (
        <p
          role={error ? "alert" : undefined}
          className={cn("mt-2 text-xs", error ? "text-destructive" : "text-muted-foreground")}
        >
          {error ?? `Jusqu’à ${MAX_ATTACHMENTS} captures d’écran (png, jpg ou webp, 5 Mo maximum).`}
        </p>
      )}
    </div>
  );
}
