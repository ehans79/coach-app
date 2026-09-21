import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getActivityDetail,
  getActivityHrGapSeries,
  getActivityReps,
  getActivityPowerView,
  WRIST_POWER_CAVEAT,
} from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { StatTile } from "@/components/StatTile";
import { adherenceToBadge, flagToVerdict } from "@/components/Badge";
import { HeroVerdict } from "@/components/HeroVerdict";
import { HrGapDecouplingChart } from "@/components/charts/HrGapDecouplingChart";
import { IntervalRepsChart } from "@/components/charts/IntervalRepsChart";
import { ZoneDistributionPanel } from "@/components/ZoneDistributionPanel";
import { formatCadence, formatDuration, formatKm, formatPace } from "@/lib/format";

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
  const [hrGapSeries, reps, power] = await Promise.all([
    getActivityHrGapSeries(activityId),
    activity.metrics?.runType === "interval" ? getActivityReps(activityId) : Promise.resolve([]),
    getActivityPowerView(activityId),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/activities" className="text-xs font-medium text-ink-muted hover:text-ink-primary">
        ← Activity Feed
      </Link>

      <div className="mt-2 mb-6">
        <div className="text-xs font-medium text-ink-muted">
          {formatDate(activity.startDateLocal)} · {activity.sportType}
        </div>
        <h1 className="mt-1 text-xl font-semibold text-ink-primary">{activity.name}</h1>
      </div>

      {activity.comment && (
        <div className="mb-6">
          <HeroVerdict
            tone={flagToVerdict(activity.comment.flag).tone}
            eyebrow={adherenceToBadge(activity.comment.zoneAdherence).label}
            headline={flagToVerdict(activity.comment.flag).headline}
          >
            {activity.comment.commentText}
          </HeroVerdict>
        </div>
      )}

      {hrGapSeries && hrGapSeries.length > 0 && (
        <div className="mb-6">
          <HrGapDecouplingChart data={hrGapSeries} />
        </div>
      )}

      {activity.metrics?.runType === "interval" && reps.length > 0 && (
        <div className="mb-6">
          <IntervalRepsChart reps={reps} />
        </div>
      )}

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
            value={formatCadence(activity.averageCadence, activity.sportType)}
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

      {(activity.durability || activity.qualifyingEffort) && (
        <Card title="Race read" className="mb-6">
          {activity.qualifyingEffort && (
            <div className="mb-4">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold text-ink-primary tabular-nums">
                  {activity.qualifyingEffort.vdot.toFixed(1)}
                </span>
                <span className="text-sm text-ink-secondary">VDOT from this effort</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {activity.qualifyingEffort.source === "strava_race"
                  ? "Tagged as a race in Strava."
                  : `Detected as a time-trial-quality effort: ${activity.qualifyingEffort.detectionNotes.join("; ")}.`}{" "}
                Computed via the Daniels-Gilbert equations from the grade-adjusted distance.
              </p>
            </div>
          )}

          {activity.durability && (
            <div className={activity.qualifyingEffort ? "border-t border-gridline pt-4" : undefined}>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold text-ink-primary tabular-nums">
                  {activity.durability.percentOfCriticalSpeed.toFixed(0)}%
                </span>
                <span className="text-sm text-ink-secondary">of Critical Speed sustained</span>
              </div>
              <p className="mt-1 text-sm text-ink-secondary">
                Held {activity.durability.percentOfCriticalSpeed.toFixed(0)}% of your fitted Critical Speed (
                {formatPace(activity.durability.criticalSpeedPaceSecPerKm)}, fitted {activity.durability.csAsOfDate}).
                For orientation, world-class marathoners average around{" "}
                {activity.durability.eliteBenchmarkPercent}% of CS over a marathon and recreational runners around{" "}
                {activity.durability.recreationalBenchmarkPercent}%.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                {activity.durability.benchmarkCaveat} A higher number isn&rsquo;t automatically a better race &mdash;
                it&rsquo;s a description of how much of your ceiling the effort used, not a target to chase.
              </p>
            </div>
          )}
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

      {(facts && Object.keys(facts.zoneAdherence.distributionPercent).length > 0) || power ? (
        <Card
          title="Time in zone"
          subtitle={power ? "Switch between heart-rate and power zones" : undefined}
          className="mb-6"
        >
          <ZoneDistributionPanel
            hrZones={Object.entries(facts?.zoneAdherence.distributionPercent ?? {})
              .map(([key, pct]) => ({
                zone: Number(key.match(/^zone(\d)/)?.[1] ?? 0),
                label: key.replace(/_/g, " ").replace(/^zone(\d)/, "Zone $1 —"),
                percent: pct,
              }))
              // jsonb hands these back ordered by key length, not by zone — sort explicitly.
              .sort((a, b) => a.zone - b.zone)}
            power={power}
            wristPowerCaveat={WRIST_POWER_CAVEAT}
          />
        </Card>
      ) : null}

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
