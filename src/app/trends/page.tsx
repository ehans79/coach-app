import {
  getWeeklyVolumeTrend,
  getZoneAdherenceTrend,
  getDailyLoadTrend,
  getWeeklyIntensityDistribution,
} from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { TrainingLoadPanel } from "@/components/charts/TrainingLoadPanel";
import { LongRunChart } from "@/components/charts/LongRunChart";
import { ZoneTrendChart } from "@/components/charts/ZoneTrendChart";
import { CtlAtlTsbChart } from "@/components/charts/CtlAtlTsbChart";
import { AcwrTrendChart } from "@/components/charts/AcwrTrendChart";
import { IntensityDistributionChart } from "@/components/charts/IntensityDistributionChart";

export default async function TrendsPage() {
  const [volumeTrend, zoneTrend, dailyLoadTrend, intensityDistribution] = await Promise.all([
    getWeeklyVolumeTrend(),
    getZoneAdherenceTrend(),
    getDailyLoadTrend(),
    getWeeklyIntensityDistribution(),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-extrabold tracking-tight text-ink-primary">Trends</h1>

      {volumeTrend.length === 0 ? (
        <Card>
          <EmptyState message="No run history yet." />
        </Card>
      ) : (
        <TrainingLoadPanel data={volumeTrend} />
      )}

      {dailyLoadTrend.length === 0 ? (
        <Card className="mt-4">
          <EmptyState message="No training-load history yet." />
        </Card>
      ) : (
        <div className="mt-4">
          <CtlAtlTsbChart data={dailyLoadTrend} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Long-run progression" subtitle="Longest single run per week">
          {volumeTrend.length === 0 ? (
            <EmptyState message="No run history yet." />
          ) : (
            <LongRunChart data={volumeTrend} />
          )}
        </Card>

        <Card
          title="Zone adherence over time"
          subtitle="% of weekly running time in each HR zone — watch for easy weeks drifting into Zone 3+"
        >
          {zoneTrend.length === 0 ? (
            <EmptyState message="No zone data yet — this fills in as activities get commented on." />
          ) : (
            <ZoneTrendChart data={zoneTrend} />
          )}
        </Card>

        {dailyLoadTrend.length === 0 ? (
          <Card>
            <EmptyState message="No ACWR data yet." />
          </Card>
        ) : (
          <AcwrTrendChart data={dailyLoadTrend} />
        )}

        {intensityDistribution.length === 0 ? (
          <Card>
            <EmptyState message="No intensity-distribution data yet." />
          </Card>
        ) : (
          <IntensityDistributionChart data={intensityDistribution} />
        )}
      </div>
    </div>
  );
}
