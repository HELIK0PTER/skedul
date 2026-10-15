/** Error box of a form or a dialog: nothing for an empty message, else an alert. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-rose-700">
      {message}
    </p>
  );
}
