import { getWeeklyVolumeTrend, getZoneAdherenceTrend } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { WeeklyVolumeChart } from "@/components/charts/WeeklyVolumeChart";
import { LongRunChart } from "@/components/charts/LongRunChart";
import { ZoneTrendChart } from "@/components/charts/ZoneTrendChart";

export default async function TrendsPage() {
  const [volumeTrend, zoneTrend] = await Promise.all([getWeeklyVolumeTrend(), getZoneAdherenceTrend()]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-xl font-semibold text-ink-primary">Trends</h1>

      <Card title="Weekly running volume" subtitle="Total km per week, across full training history" className="mb-6">
        {volumeTrend.length === 0 ? (
          <EmptyState message="No run history yet." />
        ) : (
          <WeeklyVolumeChart data={volumeTrend} />
        )}
      </Card>

      <Card title="Long-run progression" subtitle="Longest single run per week" className="mb-6">
        {volumeTrend.length === 0 ? (
          <EmptyState message="No run history yet." />
        ) : (
          <LongRunChart data={volumeTrend} />
        )}
      </Card>

      <Card
        title="Zone adherence over time"
        subtitle="% of weekly running time spent in each HR zone — watch for easy weeks drifting into Zone 3+"
      >
        {zoneTrend.length === 0 ? (
          <EmptyState message="No zone data yet — this fills in as activities get commented on." />
        ) : (
          <ZoneTrendChart data={zoneTrend} />
        )}
      </Card>
    </div>
  );
}
