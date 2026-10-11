"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";

import { ImageAttachInput, type PickedImage } from "@/components/support/image-attach-input";
import { Button } from "@/components/ui/button";
import { MAX_BODY } from "@/lib/support";
import { cn } from "@/lib/utils";

type Result = { ok: true; warning?: string } | { ok: false; error: string };

/**
 * Reply box shared by the requester and the admin; `action` is the Server
 * Action to call (replyToSupportRequest or adminReply).
 */
export function MessageComposer({
  requestId,
  action,
  imagesEnabled,
  disabledReason = null,
  placeholder = "Votre réponse",
  className,
}: {
  requestId: string;
  action: (data: FormData) => Promise<Result>;
  imagesEnabled: boolean;
  disabledReason?: string | null;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [notice, setNotice] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (disabledReason) {
    return (
      <p
        className={cn(
          "rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground",
          className,
        )}
      >
        {disabledReason}
      </p>
    );
  }

  const empty = !body.trim() && images.length === 0;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (empty || pending) return;
    const data = new FormData();
    data.set("requestId", requestId);
    data.set("body", body);
    images.forEach((i) => data.append("images", i.file));
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await action(data);
        if (!res.ok) {
          setNotice({ tone: "error", text: res.error });
          return;
        }
        images.forEach((i) => URL.revokeObjectURL(i.url));
        setBody("");
        setImages([]);
        if (res.warning) setNotice({ tone: "warning", text: res.warning });
        router.refresh();
      } catch {
        setNotice({ tone: "error", text: "Connexion perdue. Réessayez." });
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        "rounded-2xl border border-border bg-card p-3 shadow-(--shadow-card) transition-[border-color,box-shadow] focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10",
        className,
      )}
    >
      <label htmlFor={`reply-${requestId}`} className="sr-only">
        Votre message
      </label>
      <textarea
        id={`reply-${requestId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") e.currentTarget.form?.requestSubmit();
        }}
        maxLength={MAX_BODY}
        rows={4}
        placeholder={placeholder}
        className="block w-full resize-y bg-transparent px-2 py-1.5 text-[0.9375rem] leading-relaxed outline-none placeholder:text-muted-foreground"
      />
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3 px-1">
        {imagesEnabled ? (
          <ImageAttachInput images={images} onChange={setImages} disabled={pending} compact />
        ) : (
          <span />
        )}
        <Button type="submit" className="rounded-full" disabled={empty || pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          Envoyer
        </Button>
      </div>
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn("mt-2 px-2 text-sm", notice.tone === "error" ? "text-destructive" : "text-warning")}
        >
          {notice.text}
        </p>
      )}
    </form>
  );
}
