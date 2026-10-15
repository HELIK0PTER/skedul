import { Label } from "@/components/ui/label";

/**
 * Label above the control, helper and error below (never a placeholder as a
 * label). The child must carry `id={htmlFor}`; it can point at the helper and
 * the error with aria-describedby (`${htmlFor}-help`, `${htmlFor}-error`).
 */
export function FormField({
  label,
  htmlFor,
  help,
  error,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  help?: string;
  error?: string | null;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">{" (facultatif)"}</span>}
      </Label>
      {children}
      {help && (
        <p id={`${htmlFor}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
