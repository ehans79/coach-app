import {
  getWeeklyVolumeTrend,
  getZoneAdherenceTrend,
  getDailyLoadTrend,
  getWeeklyIntensityDistribution,
  getVdotView,
  getCriticalSpeedView,
  getPowerDurationView,
  WRIST_POWER_CAVEAT,
} from "@/lib/dashboard/queries";
import { assessTrainingStrain } from "@/lib/metrics/strain";
import { formatPace } from "@/lib/format";

export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { StrainBanner, StrainSignalTable } from "@/components/StrainBanner";
import { TrainingLoadPanel } from "@/components/charts/TrainingLoadPanel";
import { LongRunChart } from "@/components/charts/LongRunChart";
import { ZoneTrendChart } from "@/components/charts/ZoneTrendChart";
import { CtlAtlTsbChart } from "@/components/charts/CtlAtlTsbChart";
import { AcwrTrendChart } from "@/components/charts/AcwrTrendChart";
import { IntensityDistributionChart } from "@/components/charts/IntensityDistributionChart";
import { VdotTrendChart } from "@/components/charts/VdotTrendChart";
import { MeanMaxPaceChart } from "@/components/charts/MeanMaxPaceChart";
import { PowerDurationChart } from "@/components/charts/PowerDurationChart";
import { VdotPanel } from "@/components/VdotPanel";

export default async function TrendsPage() {
  const [volumeTrend, zoneTrend, dailyLoadTrend, intensityDistribution, vdot, criticalSpeed, strain, power] =
    await Promise.all([
      getWeeklyVolumeTrend(),
      getZoneAdherenceTrend(),
      getDailyLoadTrend(),
      getWeeklyIntensityDistribution(),
      getVdotView(),
      getCriticalSpeedView(),
      assessTrainingStrain(),
      getPowerDurationView(),
    ]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-extrabold tracking-tight text-ink-primary">Trends</h1>

      {strain.triggered && (
        <div className="mb-4">
          <StrainBanner assessment={strain} />
        </div>
      )}

      <VdotPanel view={vdot}>
        {vdot.history.length >= 2 ? (
          <VdotTrendChart data={vdot.history} />
        ) : (
          // A dashed EmptyState box would be a large void inside an otherwise dense
          // card — one muted line says the same thing without the hole.
          <p className="text-xs text-ink-muted">
            {vdot.history.length === 1
              ? "One qualifying effort so far — a second one gives this a trend to draw."
              : "No race-quality efforts detected yet."}
          </p>
        )}
      </VdotPanel>

      <Card
        className="mt-4"
        title="Best efforts &amp; Critical Speed"
        subtitle="Fastest grade-adjusted pace sustained at each duration, across every run — with the two-parameter model fitted through it"
      >
        {criticalSpeed.points.length === 0 ? (
          <EmptyState message="No best efforts recorded yet — these fill in as runs sync." />
        ) : (
          <>
            <MeanMaxPaceChart points={criticalSpeed.points} csPaceSecPerKm={criticalSpeed.csPaceSecPerKm} />
            {criticalSpeed.fit ? (
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gridline pt-4 sm:grid-cols-4">
                <div>
                  <div className="text-xs text-ink-muted">Critical Speed</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-ink-primary tabular-nums">
                    {formatPace(criticalSpeed.fit.criticalSpeedPaceSecPerKm)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">D&prime;</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-ink-primary tabular-nums">
                    {Math.round(criticalSpeed.fit.dPrimeMeters)}m
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Fit quality</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-ink-primary tabular-nums">
                    r&sup2; {criticalSpeed.fit.rSquared.toFixed(3)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Points used</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-ink-primary tabular-nums">
                    {criticalSpeed.fit.points.length}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 border-t border-gridline pt-4">
                <EmptyState message="Not enough of the curve filled in to fit Critical Speed yet." />
              </div>
            )}
            <p className="mt-4 text-xs leading-relaxed text-ink-muted">
              CS is the speed asymptote separating the heavy and severe intensity domains; D&prime; is the distance
              runnable above it. Fitted over 2&ndash;30 minute efforts only. These come from ordinary training runs
              rather than all-out tests, so the fit is only as honest as the efforts behind it: wherever the model line
              sits above your actual best, no genuinely maximal effort of that length exists in the history yet. The two
              lines should converge as those accumulate.
            </p>
          </>
        )}
      </Card>

      <Card
        className="mt-4"
        title="Running power &amp; Critical Power"
        subtitle="Best sustained power at each duration, with the same two-parameter model fitted through it"
      >
        {power.points.length === 0 ? (
          <EmptyState message="No power data yet — this fills in as runs with wrist power sync." />
        ) : (
          <>
            <PowerDurationChart
              points={power.points}
              criticalPowerWatts={power.fit?.criticalPowerWatts ?? null}
            />
            {power.fit ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gridline pt-4 sm:grid-cols-4">
                  <div>
                    <div className="text-xs text-ink-muted">Critical Power</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-ink-primary tabular-nums">
                      {Math.round(power.fit.criticalPowerWatts)}W
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-muted">W&prime;</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-ink-primary tabular-nums">
                      {(power.fit.wPrimeJoules / 1000).toFixed(1)}kJ
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-muted">Fit quality</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-ink-primary tabular-nums">
                      r&sup2; {power.fit.rSquared.toFixed(3)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-muted">Points used</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-ink-primary tabular-nums">
                      {power.fit.points.length}
                    </div>
                  </div>
                </div>

                {power.zones.length > 0 && (
                  <div className="mt-4 border-t border-gridline pt-4">
                    <div className="text-xs font-medium text-ink-muted">Power zones (% of CP)</div>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-sm">
                        <tbody>
                          {power.zones.map((z) => (
                            <tr key={z.zone} className="border-t border-gridline first:border-t-0">
                              <td className="w-full py-2 pr-3 whitespace-nowrap">
                                <span className="font-medium text-ink-primary">
                                  Zone {z.zone} — {z.name}
                                </span>
                                <span className="ml-1.5 text-ink-muted">
                                  {z.lowPercentOfCp}
                                  {z.highPercentOfCp != null ? `\u2013${z.highPercentOfCp}` : "+"}%
                                </span>
                              </td>
                              <td className="py-2 text-right whitespace-nowrap text-ink-secondary tabular-nums">
                                {z.lowWatts}
                                {z.highWatts != null ? `\u2013${z.highWatts}` : "+"}W
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-4 border-t border-gridline pt-4">
                <EmptyState message="Not enough of the curve filled in to fit Critical Power yet." />
              </div>
            )}
            <p className="mt-4 text-xs leading-relaxed text-ink-muted">
              CP is the power asymptote separating the heavy and severe intensity domains; W&prime; is the finite work
              available above it. Fitted over 2&ndash;30 minute efforts only, so wherever the model line sits above your
              actual best &mdash; typically the 1-hour end &mdash; it means no genuinely maximal effort of that length
              exists in the history yet, not that you underperformed. {WRIST_POWER_CAVEAT}
            </p>
          </>
        )}
      </Card>

      <Card className="mt-4" title="Fatigue signals" subtitle="The four things checked before anything gets flagged">
        <StrainSignalTable assessment={strain} />
      </Card>

      {volumeTrend.length === 0 ? (
        <Card className="mt-4">
          <EmptyState message="No run history yet." />
        </Card>
      ) : (
        <div className="mt-4">
          <TrainingLoadPanel data={volumeTrend} />
        </div>
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
