"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { updateProfile } from "@/server/pro";
import { FormError } from "@/components/dashboard/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PRO_TIMEZONES, timeZoneLabel } from "@/lib/timezones";

export interface ProfileValues {
  businessName: string;
  headline: string | null;
  bio: string | null;
  timezone: string;
}

const LOCKED_HELP = "Fuseau verrouillé : vous avez des séances planifiées, des indisponibilités à venir ou des tickets à durée limitée.";

export function ProfileForm({ values, timezoneLocked }: { values: ProfileValues; timezoneLocked: boolean }) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a zone the pro already has but the list does not offer stays selectable
  const zones = PRO_TIMEZONES.some((zone) => zone.id === values.timezone)
    ? PRO_TIMEZONES
    : [...PRO_TIMEZONES, { id: values.timezone, label: timeZoneLabel(values.timezone) }];

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const res = await updateProfile({
        businessName: String(f.get("businessName") ?? ""),
        headline: String(f.get("headline") ?? ""),
        bio: String(f.get("bio") ?? ""),
        // a disabled select is not part of the form data: keep the current zone
        timezone: String(f.get("timezone") ?? values.timezone),
      });
      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="businessName">Nom de l&apos;activité</Label>
        <Input id="businessName" name="businessName" defaultValue={values.businessName} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="headline">Accroche</Label>
        <Input id="headline" name="headline" defaultValue={values.headline ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bio">Présentation</Label>
        <Textarea id="bio" name="bio" rows={4} defaultValue={values.bio ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="timezone">Fuseau horaire</Label>
        <Select
          id="timezone"
          name="timezone"
          defaultValue={values.timezone}
          disabled={timezoneLocked}
          aria-describedby={timezoneLocked ? "timezone-help" : undefined}
        >
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.label}
            </option>
          ))}
        </Select>
        {timezoneLocked && (
          <p id="timezone-help" className="text-xs text-muted-foreground">
            {LOCKED_HELP}
          </p>
        )}
      </div>

      <FormError message={error} />

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Enregistrer
        </Button>
        {saved && (
          <span role="status" className="text-sm text-success">
            Enregistré
          </span>
        )}
      </div>
    </form>
  );
}
