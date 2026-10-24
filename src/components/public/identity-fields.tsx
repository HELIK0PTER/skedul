"use client";

import { FormField } from "@/components/dashboard/form-field";
import { Input } from "@/components/ui/input";
import type { IdentityInput } from "@/lib/public/booking-actions";
import { dataUseLine } from "@/lib/public/messages";
import { BOUNDS } from "@/lib/tickets-vocab";

/**
 * Name, e-mail and phone of a public form (Decision 12: the minimum the engine needs, one data-use line, no consent
 * box). `emailLocked` is true only for a VERIFIED session, whose e-mail then comes from the session (a personal-link
 * cookie never fills or locks a field, Decision 7). Errors are read from the keys of the whole-input parse
 * (`identity.name`, `identity.email`, `identity.phone`). The honeypot is an empty field a person never sees: a
 * filled one is refused by the server before anything is read.
 */
export function IdentityFields({
  idPrefix,
  value,
  onChange,
  emailLocked,
  errors,
  businessName,
  website,
  onWebsite,
}: {
  idPrefix: string;
  value: IdentityInput;
  onChange: (v: IdentityInput) => void;
  emailLocked: boolean;
  errors: Record<string, string>;
  businessName: string;
  website: string;
  onWebsite: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <FormField label="Prénom et nom" htmlFor={`${idPrefix}-name`} error={errors["identity.name"]}>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          autoComplete="name"
          maxLength={BOUNDS.name}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </FormField>
      <FormField
        label="Email"
        htmlFor={`${idPrefix}-email`}
        help={emailLocked ? "Adresse de votre compte." : undefined}
        error={errors["identity.email"]}
      >
        <Input
          id={`${idPrefix}-email`}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={value.email}
          readOnly={emailLocked}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
        />
      </FormField>
      <FormField label="Téléphone" optional htmlFor={`${idPrefix}-phone`} error={errors["identity.phone"]}>
        <Input
          id={`${idPrefix}-phone`}
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={BOUNDS.phone}
          value={value.phone ?? ""}
          onChange={(e) => onChange({ ...value, phone: e.target.value })}
        />
      </FormField>
      <p className="text-xs text-zinc-600 wrap-anywhere">{dataUseLine(businessName)}</p>
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor={`${idPrefix}-website`}>Laissez ce champ vide</label>
        <input
          id={`${idPrefix}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => onWebsite(e.target.value)}
        />
      </div>
    </div>
  );
}
