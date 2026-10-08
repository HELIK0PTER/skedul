"use client";

import { useState } from "react";

import { niceCeil } from "@/lib/admin-metrics";
import { cn } from "@/lib/utils";

export type BarDatum = {
  key: string;
  /** Axis + tooltip label, e.g. "mar. 6 oct.". */
  label: string;
  value: number;
  /** Secondary tooltip line, e.g. "42 pages vues". */
  detail?: string;
};

const fmt = (n: number) => n.toLocaleString("fr-FR");

/**
 * Single-series column chart (one bar per day): ≤24px bars with a 4px rounded
 * top and a 2px gap, hairline grid, hover/arrow-key tooltip, data-table
 * fallback. One series → no legend; the card title names it.
 */
export function BarChart({
  data,
  unit,
  emptyLabel = "Aucune donnée sur la période.",
}: {
  data: BarDatum[];
  /** Singular / plural unit, e.g. { one: "visiteur", other: "visiteurs" }. */
  unit: { one: string; other: string };
  emptyLabel?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const max = niceCeil(Math.max(0, ...data.map((d) => d.value)));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const unitFor = (n: number) => (n > 1 ? unit.other : unit.one);
  const current = active === null ? null : data[active];
  const align =
    active === null
      ? ""
      : active < data.length * 0.15
        ? "translate-x-0"
        : active > data.length * 0.85
          ? "-translate-x-full"
          : "-translate-x-1/2";

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // Alt/Cmd+← → are the browser's back/forward: leave them alone.
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    setActive((i) =>
      i === null
        ? step === 1
          ? 0
          : data.length - 1
        : Math.min(data.length - 1, Math.max(0, i + step)),
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex h-40 flex-col justify-between text-right text-[11px] tabular-nums text-muted-foreground">
          <span>{fmt(max)}</span>
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="relative h-40 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
            role="group"
            aria-label={`${fmt(total)} ${unitFor(total)} au total. Flèches gauche et droite pour parcourir les jours.`}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-border" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-border" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-border" />
            <div className="absolute inset-0 flex items-end gap-0.5">
              {data.map((d, i) => (
                <div
                  key={d.key}
                  className="flex h-full flex-1 items-end justify-center"
                  onPointerEnter={() => setActive(i)}
                >
                  <div
                    className={cn(
                      "w-full max-w-6 rounded-t-[4px] bg-primary transition-opacity",
                      active !== null && active !== i && "opacity-40",
                    )}
                    style={{ height: `${(d.value / max) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            {current && active !== null && (
              <div
                role="status"
                className={cn(
                  "pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-(--shadow-card)",
                  align,
                )}
                style={{ left: `${((active + 0.5) / data.length) * 100}%` }}
              >
                <p className="font-semibold tabular-nums text-foreground">
                  {fmt(current.value)} {unitFor(current.value)}
                </p>
                {current.detail && <p className="text-muted-foreground">{current.detail}</p>}
                <p className="text-muted-foreground">{current.label}</p>
              </div>
            )}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{data[0].label}</span>
            {data.length > 2 && <span>{data[Math.floor(data.length / 2)].label}</span>}
            <span>{data[data.length - 1].label}</span>
          </div>
        </div>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Voir les données
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">Jour</th>
              <th className="py-1 text-right font-medium">{unit.other}</th>
              {data.some((d) => d.detail) && (
                <th className="py-1 text-right font-medium">Détail</th>
              )}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.map((d) => (
              <tr key={d.key} className="border-t border-border">
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-right">{fmt(d.value)}</td>
                {d.detail !== undefined && <td className="py-1 text-right">{d.detail}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
