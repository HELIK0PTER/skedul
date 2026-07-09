import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { THEME_PRESETS, brandThemeVars } from "@/lib/color";
import { cn } from "@/lib/utils";
import { DEMO_BRAND } from "../demo-data";
import { ProShell } from "./pro-shell";
import type { ScreenProps } from "./index";

export function ProBranding({ state }: ScreenProps) {
  const vitrine = state.headerLayout === "vitrine";

  return (
    <ProShell active="settings">
      <h1 className="text-xl font-bold tracking-tight">Réglages</h1>
      <p className="text-sm text-muted-foreground">Votre profil public et vos préférences.</p>

      <Card className="mt-4">
        <CardContent className="space-y-4 p-4">
          <div>
            <h2 className="font-semibold">Identité visuelle</h2>
            <p className="text-sm text-muted-foreground">
              Couleur et mise en page de votre page publique, avec aperçu en direct.
            </p>
          </div>

          {/* Aperçu en direct — se rethème instantanément via brandThemeVars */}
          <div
            className="overflow-hidden rounded-xl border border-border"
            style={brandThemeVars(state.brandColor)}
          >
            <div
              className="h-14"
              style={{
                background: `linear-gradient(180deg, ${state.brandColor}22, transparent)`,
              }}
            />
            <div
              className={cn(
                "px-4 pb-4",
                vitrine ? "flex flex-col items-center text-center" : "flex items-end gap-3",
              )}
            >
              <span className="-mt-6 grid size-12 shrink-0 place-items-center rounded-2xl border-4 border-card bg-accent text-sm font-semibold text-accent-foreground shadow-sm">
                AP
              </span>
              <div className={cn(vitrine ? "mt-2" : "pb-0.5")}>
                <p className="text-sm font-bold">{DEMO_BRAND.businessName}</p>
                <p className="text-xs text-muted-foreground">{DEMO_BRAND.headline}</p>
              </div>
              <span className={cn("flex gap-2", vitrine ? "mt-2" : "ml-auto pb-0.5")}>
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                  Réserver
                </span>
                <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                  Pack 10 heures
                </span>
              </span>
            </div>
          </div>

          <div>
            <Label>Thème couleur</Label>
            <div className="mt-2 flex gap-2.5">
              {THEME_PRESETS.map((p) => (
                <span
                  key={p.id}
                  data-demo={p.color === "#0d9488" ? "swatch-turquoise" : undefined}
                  title={p.label}
                  className={cn(
                    "size-9 rounded-full transition-transform",
                    state.brandColor === p.color && "scale-110 border-2 border-foreground",
                  )}
                  style={{ backgroundColor: p.color }}
                />
              ))}
            </div>
          </div>

          <div>
            <Label>Mise en page</Label>
            <div className="mt-2 flex gap-2">
              {(["profil", "vitrine"] as const).map((l) => (
                <span
                  key={l}
                  data-demo={l === "vitrine" ? "layout-vitrine" : undefined}
                  className={cn(
                    "flex-1 rounded-xl border px-4 py-2 text-center text-sm font-medium capitalize",
                    state.headerLayout === l
                      ? "border-primary bg-primary-muted text-primary"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {l}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-2 border-t border-border pt-3">
            <Button size="sm">Enregistrer</Button>
            <Button size="sm" variant="ghost">
              Annuler
            </Button>
          </div>
        </CardContent>
      </Card>
    </ProShell>
  );
}
