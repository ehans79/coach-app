import Link from "next/link";
import { notFound } from "next/navigation";
import { getActivityDetail } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { StatTile } from "@/components/StatTile";
import { Badge, flagToBadge, adherenceToBadge } from "@/components/Badge";
import { formatKm, formatDuration, formatPace } from "@/lib/format";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activityId = Number(id);
  if (!Number.isFinite(activityId)) notFound();

  const activity = await getActivityDetail(activityId);
  if (!activity) notFound();

  const avgPaceSecPerKm =
    activity.movingTimeSeconds && activity.distanceMeters
      ? activity.movingTimeSeconds / (activity.distanceMeters / 1000)
      : null;

  const facts = activity.comment?.facts ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/activities" className="text-xs font-medium text-ink-muted hover:text-ink-primary">
        ← Activity Feed
      </Link>

      <div className="mb-6 mt-2 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-ink-muted">
            {formatDate(activity.startDateLocal)} · {activity.sportType}
          </div>
          <h1 className="mt-1 text-xl font-semibold text-ink-primary">{activity.name}</h1>
        </div>
        {activity.comment && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge {...flagToBadge(activity.comment.flag)} />
            <Badge {...adherenceToBadge(activity.comment.zoneAdherence)} />
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Distance" value={formatKm(activity.distanceMeters)} />
        <StatTile label="Duration" value={formatDuration(activity.movingTimeSeconds)} />
        <StatTile label="Avg pace" value={formatPace(avgPaceSecPerKm)} />
        {activity.averageHeartrate != null && (
          <StatTile
            label="Heart rate"
            value={`${Math.round(activity.averageHeartrate)}bpm avg`}
            detail={activity.maxHeartrate != null ? `${Math.round(activity.maxHeartrate)}bpm max` : undefined}
          />
        )}
        {activity.averageCadence != null && (
          <StatTile
            label="Cadence"
            value={`${Math.round(activity.averageCadence)}`}
            detail={
              facts?.cadence.deltaVsRollingAverage != null
                ? `${facts.cadence.deltaVsRollingAverage > 0 ? "+" : ""}${facts.cadence.deltaVsRollingAverage} vs rolling avg`
                : undefined
            }
          />
        )}
        {activity.totalElevationGainMeters != null && (
          <StatTile label="Elevation gain" value={`${Math.round(activity.totalElevationGainMeters)}m`} />
        )}
        {activity.sufferScore != null && <StatTile label="Suffer score" value={`${activity.sufferScore}`} />}
      </div>

      {activity.comment && (
        <Card title="Coach's take" className="mb-6">
          <p className="text-sm text-ink-secondary">{activity.comment.commentText}</p>
        </Card>
      )}

      {facts?.prescription && (
        <Card title="Prescribed workout" className="mb-6">
          <div className="text-sm font-medium text-ink-primary">{facts.prescription.name}</div>
          {facts.prescription.instructions && (
            <p className="mt-1 text-sm text-ink-secondary">{facts.prescription.instructions}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-ink-muted">
            {facts.prescription.targetDistanceKm && <span>Target: {facts.prescription.targetDistanceKm}</span>}
            {facts.prescription.targetDurationMinutes && (
              <span>{facts.prescription.targetDurationMinutes} min</span>
            )}
            {facts.prescription.primaryZone && <span>Zone: {facts.prescription.primaryZone}</span>}
          </div>
        </Card>
      )}

      {facts && Object.keys(facts.zoneAdherence.distributionPercent).length > 0 && (
        <Card title="Zone time distribution" className="mb-6">
          <div className="flex flex-col gap-1.5">
            {Object.entries(facts.zoneAdherence.distributionPercent).map(([zone, pct]) => (
              <div key={zone} className="flex items-center justify-between text-sm">
                <span className="text-ink-secondary">{zone.replace(/_/g, " ")}</span>
                <span className="font-medium text-ink-primary">{pct}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {facts?.paceFade && (
        <Card title="Pace fade" className="mb-6">
          <div className="flex justify-between text-sm text-ink-secondary">
            <span>First half: {facts.paceFade.firstHalf}</span>
            <span>Second half: {facts.paceFade.secondHalf}</span>
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            {facts.paceFade.fadePercent > 0 ? "+" : ""}
            {facts.paceFade.fadePercent}% {facts.paceFade.fadePercent > 0 ? "slower" : "faster"} in the second half
          </div>
        </Card>
      )}

      {facts?.weather && (
        <Card title="Weather">
          <p className="text-sm text-ink-secondary">
            {facts.weather.tempC} · {facts.weather.conditions}
          </p>
        </Card>
      )}
    </div>
  );
}
