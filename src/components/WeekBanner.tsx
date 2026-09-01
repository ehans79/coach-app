function formatDateRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-GB", opts);
  const e = new Date(`${end}T00:00:00Z`).toLocaleDateString("en-GB", opts);
  return `${s} – ${e}`;
}

export function WeekBanner({
  weekNumber,
  startDate,
  endDate,
  focus,
  weekVerdict,
  isRecoveryWeek,
  sessionsCompleted,
  sessionsPlanned,
}: {
  weekNumber: number;
  startDate: string;
  endDate: string;
  focus: string;
  weekVerdict: string | null;
  isRecoveryWeek: boolean;
  sessionsCompleted: number;
  sessionsPlanned: number;
}) {
  const progressPercent = sessionsPlanned > 0 ? Math.round((sessionsCompleted / sessionsPlanned) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-surface p-4 shadow-pop sm:p-6">
      <div className="min-w-0">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <span>
            Week {weekNumber} · {formatDateRange(startDate, endDate)}
          </span>
          {isRecoveryWeek && (
            <span className="rounded-full bg-status-warning-soft px-2 py-0.5 text-status-warning">Recovery</span>
          )}
        </div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink-primary text-balance sm:text-2xl">
          {weekVerdict ?? focus}
        </h1>
        {weekVerdict && <p className="mt-1.5 text-sm text-ink-secondary">{focus}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(var(--accent) ${progressPercent}%, var(--border-strong) ${progressPercent}% 100%)`,
          }}
        >
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-surface text-sm font-bold tabular-nums text-ink-primary">
            {sessionsCompleted}/{sessionsPlanned}
          </div>
        </div>
      </div>
    </div>
  );
}
