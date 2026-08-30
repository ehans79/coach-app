export function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-ink-primary tabular-nums">{value}</div>
      {detail && <div className="mt-1 text-xs text-ink-secondary">{detail}</div>}
    </div>
  );
}
