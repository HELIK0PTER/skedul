import { Check } from "lucide-react";

/**
 * The « Enregistré » line beside a form's save button. The `role="status"` region is always mounted and only its
 * content changes: a live region inserted together with its text is not reliably announced. `text-green-700` reads
 * AA on white (the `success` token, 3.3:1, is for fills and icons).
 */
export function SavedStatus({ saved, message = "Enregistré" }: { saved: boolean; message?: string }) {
  return (
    <span role="status" className="flex items-center gap-1.5 text-sm text-green-700">
      {saved && (
        <>
          <Check className="size-4" aria-hidden="true" />
          {message}
        </>
      )}
    </span>
  );
}
