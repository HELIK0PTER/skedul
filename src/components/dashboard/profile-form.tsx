"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { updateProfile } from "@/server/pro";
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

export interface ProfileValues {
  businessName: string;
  headline: string | null;
  bio: string | null;
  brandColor: string;
  timezone: string;
}

export function ProfileForm({ values }: { values: ProfileValues }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    startTransition(async () => {
      await updateProfile({
        businessName: String(f.get("businessName")),
        headline: String(f.get("headline") ?? ""),
        bio: String(f.get("bio") ?? ""),
        brandColor: String(f.get("brandColor")),
        timezone: String(f.get("timezone")),
      });
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="businessName">Nom de l&apos;activité</Label>
        <Input
          id="businessName"
          name="businessName"
          defaultValue={values.businessName}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="headline">Accroche</Label>
        <Input
          id="headline"
          name="headline"
          defaultValue={values.headline ?? ""}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bio">Présentation</Label>
        <Textarea id="bio" name="bio" rows={4} defaultValue={values.bio ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="brandColor">Couleur de marque</Label>
          <input
            id="brandColor"
            name="brandColor"
            type="color"
            defaultValue={values.brandColor}
            className="h-10 w-full cursor-pointer rounded-xl border border-input bg-card p-1"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="timezone">Fuseau horaire</Label>
          <Select
            id="timezone"
            name="timezone"
            defaultValue={values.timezone}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Enregistrer
        </Button>
        {saved && <span className="text-sm text-success">Enregistré ✓</span>}
      </div>
    </form>
  );
}
