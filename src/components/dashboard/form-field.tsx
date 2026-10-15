import { cloneElement, Fragment, isValidElement, type ReactElement } from "react";

import { Label } from "@/components/ui/label";

type ControlProps = { "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" };

/**
 * Label above the control, helper and error below (never a placeholder as a
 * label). The child must carry `id={htmlFor}`.
 *
 * When the child is a single element (not a fragment, a list or text), the
 * field wires the accessibility of the control itself: `aria-describedby`
 * lists the helper id (`${htmlFor}-help`) and the error id (`${htmlFor}-error`)
 * that are shown, after any `aria-describedby` the child already has, and
 * `aria-invalid` is set to true while there is an error. A custom control must
 * forward these two props to its input. Callers never set them by hand.
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
  const helpId = help ? `${htmlFor}-help` : null;
  const errorId = error ? `${htmlFor}-error` : null;

  let control = children;
  if ((helpId || errorId) && isValidElement(children) && children.type !== Fragment) {
    const element = children as ReactElement<ControlProps>;
    const describedBy = [element.props["aria-describedby"], helpId, errorId].filter(Boolean).join(" ");
    control = cloneElement(element, {
      "aria-describedby": describedBy,
      ...(errorId ? { "aria-invalid": true } : {}),
    });
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">{" (facultatif)"}</span>}
      </Label>
      {control}
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
