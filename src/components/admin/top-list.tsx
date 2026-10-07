import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type TopRow = {
  key: string;
  label: React.ReactNode;
  sublabel?: string;
  value: number;
};

/** A ranked list with a thin single-hue meter per row (track = lighter step). */
export function TopList({
  title,
  unit,
  rows,
  empty = "Aucune donnée sur la période.",
}: {
  title: string;
  /**
   * Read by screen readers after each value, singular / plural
   * (e.g. { one: "vue", other: "vues" }) — same shape as BarChart's `unit`.
   */
  unit: { one: string; other: string };
  rows: TopRow[];
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {r.label}
                    {r.sublabel && (
                      // Leading space: keeps label and sublabel apart for screen readers and copy-paste.
                      <span className="ml-0.5 text-xs text-muted-foreground"> {r.sublabel}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {r.value.toLocaleString("fr-FR")}
                    <span className="sr-only"> {r.value > 1 ? unit.other : unit.one}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-primary-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(r.value / max) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
