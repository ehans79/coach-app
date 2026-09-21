import Link from "next/link";
import { getActivityFeed } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Badge, flagToBadge, adherenceToBadge } from "@/components/Badge";
import { formatCadence, formatDuration, formatKm, formatTempC } from "@/lib/format";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" });
}

export default async function ActivityFeedPage() {
  const activitiesFeed = await getActivityFeed(40);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-extrabold tracking-tight text-ink-primary">Activity Feed</h1>

      {activitiesFeed.length === 0 ? (
        <EmptyState message="No activities synced yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {activitiesFeed.map((a) => (
            <Link key={a.id} href={`/activities/${a.id}`} className="block transition-opacity hover:opacity-80">
              <Card>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-ink-muted">
                      {formatDate(a.startDateLocal)} · {a.sportType}
                    </div>
                    <div className="mt-1 text-sm font-bold text-ink-primary">{a.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-secondary">
                      {a.distanceMeters != null && <span>{formatKm(a.distanceMeters)}</span>}
                      {a.movingTimeSeconds != null && <span>{formatDuration(a.movingTimeSeconds)}</span>}
                      {a.averageHeartrate != null && <span>{Math.round(a.averageHeartrate)}bpm avg</span>}
                      {a.averageCadence != null && <span>{formatCadence(a.averageCadence, a.sportType)} cadence</span>}
                      {a.comment?.weatherTempC != null && (
                        <span>
                          {formatTempC(a.comment.weatherTempC)}
                          {a.comment.weatherConditions ? ` · ${a.comment.weatherConditions}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  {a.comment && (
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge {...flagToBadge(a.comment.flag)} />
                      <Badge {...adherenceToBadge(a.comment.zoneAdherence)} />
                    </div>
                  )}
                </div>

                {a.comment && (
                  <div className="mt-3 rounded-lg bg-page p-3">
                    <p className="text-sm text-ink-secondary">{a.comment.commentText}</p>
                  </div>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
