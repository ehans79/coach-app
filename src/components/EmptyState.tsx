export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border-strong text-sm text-ink-muted">
      {message}
    </div>
  );
}
