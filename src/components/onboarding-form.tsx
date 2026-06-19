"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { createProfessionalProfile } from "@/server/pro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TIMEZONES = [
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Geneva",
  "Europe/London",
  "America/Montreal",
  "America/New_York",
];

export function OnboardingForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          try {
            await createProfessionalProfile({
              businessName: String(formData.get("businessName")),
              headline: String(formData.get("headline") ?? ""),
              bio: String(formData.get("bio") ?? ""),
              timezone: String(formData.get("timezone") ?? "Europe/Paris"),
            });
          } catch (e) {
            // redirect() throws a special error we must ignore
            if (
              e &&
              typeof e === "object" &&
              "digest" in e &&
              String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
            ) {
              throw e;
            }
            setError("Impossible de créer le profil. Réessayez.");
          }
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="businessName">Nom de votre activité</Label>
        <Input
          id="businessName"
          name="businessName"
          placeholder="Studio Camille · Coaching & Yoga"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="headline">Accroche</Label>
        <Input
          id="headline"
          name="headline"
          placeholder="Coaching de vie & yoga privé à Paris"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bio">Présentation</Label>
        <Textarea
          id="bio"
          name="bio"
          rows={3}
          placeholder="Quelques lignes sur vous et vos prestations…"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="timezone">Fuseau horaire</Label>
        <Select id="timezone" name="timezone" defaultValue="Europe/Paris">
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Créer mon espace pro
      </Button>
    </form>
  );
}
