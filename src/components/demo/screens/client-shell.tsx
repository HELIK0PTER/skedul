import type { ReactNode } from "react";

import { DEMO_BRAND } from "../demo-data";

export function ClientShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border">
        <div
          className="h-14"
          style={{ background: `linear-gradient(180deg, ${DEMO_BRAND.brandColor}22, transparent)` }}
        />
        <div className="mx-auto flex w-full max-w-3xl items-end gap-3 px-6 pb-4">
          <span className="-mt-7 grid size-14 shrink-0 place-items-center rounded-2xl border-4 border-card bg-accent text-lg font-semibold text-accent-foreground shadow-sm">
            AP
          </span>
          <div className="pb-0.5">
            <p className="text-lg font-bold">{DEMO_BRAND.businessName}</p>
            <p className="text-xs text-muted-foreground">{DEMO_BRAND.headline}</p>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-hidden px-6 py-5">{children}</div>
    </div>
  );
}
