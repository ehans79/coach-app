import { getThisWeekView } from "@/lib/dashboard/queries";
import { assessTrainingStrain } from "@/lib/metrics/strain";

// Data changes from ongoing Strava syncs/webhooks and the weekly regen job,
// none of which correlate with a redeploy — always render fresh per request.
export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { WeekBanner } from "@/components/WeekBanner";
import { DayCard } from "@/components/DayCard";
import { StrainBanner } from "@/components/StrainBanner";

export default async function ThisWeekPage() {
  const [week, strain] = await Promise.all([getThisWeekView(), assessTrainingStrain()]);

  if (!week) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-xl font-semibold text-ink-primary">This Week</h1>
        <EmptyState message="No active plan found yet." />
      </div>
    );
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const activityWorkouts = week.workouts.filter((w) => w.sport !== "rest");

  return (
    <div className="mx-auto max-w-5xl">
      <WeekBanner
        weekNumber={week.weekNumber}
        startDate={week.startDate}
        endDate={week.endDate}
        focus={week.focus}
        weekVerdict={week.weekVerdict}
        isRecoveryWeek={week.isRecoveryWeek}
        sessionsCompleted={week.sessionsCompleted}
        sessionsPlanned={week.sessionsPlanned}
      />

      {strain.triggered && (
        <div className="mt-4">
          <StrainBanner assessment={strain} />
        </div>
      )}

      {week.planRationale && (
        <Card className="mt-4">
          <div className="text-xs font-medium text-ink-muted">Why this week looks the way it does</div>
          <p className="mt-1.5 text-sm text-ink-secondary">{week.planRationale}</p>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {activityWorkouts.map((w) => (
          <DayCard key={w.id} workout={w} isToday={w.date === todayStr} />
        ))}
      </div>
    </div>
  );
}
