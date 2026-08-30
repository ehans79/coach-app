import { getThisWeekView } from "@/lib/dashboard/queries";

// Data changes from ongoing Strava syncs/webhooks and the weekly regen job,
// none of which correlate with a redeploy — always render fresh per request.
export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { StatTile } from "@/components/StatTile";
import { EmptyState } from "@/components/EmptyState";
import { Badge, flagToBadge } from "@/components/Badge";
import { formatKm, formatDuration } from "@/lib/format";

function formatDateRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-GB", opts);
  const e = new Date(`${end}T00:00:00Z`).toLocaleDateString("en-GB", opts);
  return `${s} – ${e}`;
}

const SPORT_LABEL: Record<string, string> = {
  run: "Run",
  strength: "Strength",
  rest: "Rest",
  bike: "Ride",
};

export default async function ThisWeekPage() {
  const week = await getThisWeekView();

  if (!week) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-xl font-semibold text-ink-primary">This Week</h1>
        <EmptyState message="No active plan found yet." />
      </div>
    );
  }

  const compliancePercent =
    week.sessionsPlanned > 0 ? Math.round((week.sessionsCompleted / week.sessionsPlanned) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">
            Week {week.weekNumber} — {formatDateRange(week.startDate, week.endDate)}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">{week.focus}</p>
        </div>
        {week.isRecoveryWeek && <Badge tone="neutral" label="Recovery week" />}
      </div>

      {week.planRationale && (
        <Card className="mb-6">
          <div className="text-xs font-medium text-ink-muted">Why this week looks the way it does</div>
          <p className="mt-1.5 text-sm text-ink-secondary">{week.planRationale}</p>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4">
        <StatTile label="Sessions completed" value={`${week.sessionsCompleted}/${week.sessionsPlanned}`} />
        <StatTile label="Compliance" value={`${compliancePercent}%`} />
      </div>

      <div className="flex flex-col gap-3">
        {week.workouts.map((w) => (
          <Card key={w.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    {w.dayOfWeek}
                  </span>
                  <span className="text-xs text-ink-muted">·</span>
                  <span className="text-xs text-ink-muted">{SPORT_LABEL[w.sport] ?? w.sport}</span>
                </div>
                <div className="mt-1 text-sm font-medium text-ink-primary">{w.name}</div>
                {(w.distanceMeters || w.durationMinutes) && (
                  <div className="mt-0.5 text-xs text-ink-secondary">
                    {w.distanceMeters ? formatKm(w.distanceMeters) : null}
                    {w.distanceMeters && w.durationMinutes ? " · " : null}
                    {w.durationMinutes ? formatDuration(w.durationMinutes * 60) : null}
                  </div>
                )}
              </div>
              {w.sport !== "rest" && (
                <Badge tone={w.completed ? "good" : "neutral"} label={w.completed ? "Done" : "Upcoming"} />
              )}
            </div>

            {w.humanReadable && (
              <p className="mt-3 whitespace-pre-line text-sm text-ink-secondary">{w.humanReadable}</p>
            )}

            {w.comment && (
              <div className="mt-3 rounded-lg bg-page p-3">
                <div className="mb-1.5">
                  <Badge {...flagToBadge(w.comment.flag)} />
                </div>
                <p className="text-sm text-ink-secondary">{w.comment.commentText}</p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
