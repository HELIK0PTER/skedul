export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight wrap-anywhere">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground wrap-anywhere">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
