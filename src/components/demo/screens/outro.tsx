"use client";

export function Outro({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="grid h-64 place-items-center rounded-3xl bg-ink text-ink-foreground">
      <button type="button" onClick={onRestart} className="underline">
        Revoir la démo
      </button>
    </div>
  );
}
