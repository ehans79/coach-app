"use client";

import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Label,
} from "recharts";
import { chartColors } from "@/lib/chartColors";
import { theme } from "@/lib/theme";
import { formatEffortDuration, formatPaceClock } from "@/lib/format";
import type { MeanMaxCurvePoint } from "@/lib/dashboard/queries";

/**
 * The intervals.icu-style mean-maximal pace curve: fastest sustained grade-adjusted
 * pace at each standard duration, with the fitted two-parameter model drawn through it
 * and Critical Speed as the asymptote it decays toward.
 *
 * Two axis choices worth naming. Duration is log-scaled because the durations are
 * geometric (2/5/10/20/30/60 min) — on a linear axis the short end, which is where D′
 * lives and where the fit is most informative, collapses into the y-axis. Pace is
 * reversed so that faster reads as higher, matching every other pace chart a runner sees.
 */
export function MeanMaxPaceChart({
  points,
  csPaceSecPerKm,
}: {
  points: MeanMaxCurvePoint[];
  csPaceSecPerKm: number | null;
}) {
  const chartData = points.map((p) => ({
    durationSeconds: p.durationSeconds,
    durationLabel: formatEffortDuration(p.durationSeconds),
    graded: Math.round(p.gradedPaceSecPerKm),
    actual: p.actualPaceSecPerKm != null ? Math.round(p.actualPaceSecPerKm) : null,
    fitted: p.fittedPaceSecPerKm != null ? Math.round(p.fittedPaceSecPerKm) : null,
    activityName: p.activityName,
    achievedOn: p.achievedOn,
    usedInFit: p.usedInFit,
  }));

  const paceValues = chartData.flatMap((d) => [d.graded, d.fitted].filter((v): v is number => v != null));
  if (csPaceSecPerKm != null) paceValues.push(Math.round(csPaceSecPerKm));
  const fastest = Math.min(...paceValues);
  const slowest = Math.max(...paceValues);
  const pad = Math.max(15, (slowest - fastest) * 0.15);

  return (
    <>
      <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={chartColors.gridline} strokeDasharray="0" />
        <XAxis
          dataKey="durationSeconds"
          type="number"
          scale="log"
          domain={["dataMin", "dataMax"]}
          ticks={chartData.map((d) => d.durationSeconds)}
          tickFormatter={(v: number) => formatEffortDuration(v)}
          axisLine={{ stroke: chartColors.axis }}
          tickLine={false}
          tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
        />
        <YAxis
          reversed
          axisLine={false}
          tickLine={false}
          tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
          width={46}
          domain={[Math.floor(fastest - pad), Math.ceil(slowest + pad)]}
          tickFormatter={(v: number) => formatPaceClock(v)}
        />
        {csPaceSecPerKm != null && (
          <ReferenceLine y={Math.round(csPaceSecPerKm)} stroke={theme.statusGood} strokeDasharray="5 4" strokeWidth={1.5}>
            <Label
              value={`CS ${formatPaceClock(csPaceSecPerKm)}/km`}
              position="insideTopLeft"
              fill={theme.statusGood}
              fontSize={11}
              fontWeight={600}
            />
          </ReferenceLine>
        )}
        <Tooltip
          cursor={{ stroke: chartColors.axis }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const point = payload[0].payload as (typeof chartData)[number];
            return (
              <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
                <div className="font-medium text-ink-primary">
                  Best {point.durationLabel}: {formatPaceClock(point.graded)}/km
                </div>
                <div className="mt-0.5 text-ink-muted">grade-adjusted</div>
                {point.actual != null && (
                  <div className="text-ink-secondary">{formatPaceClock(point.actual)}/km as actually run</div>
                )}
                {point.fitted != null && (
                  <div className="text-ink-secondary">Model predicts {formatPaceClock(point.fitted)}/km</div>
                )}
                <div className="mt-1 text-ink-muted">
                  {point.activityName} · {point.achievedOn}
                </div>
                {!point.usedInFit && <div className="text-ink-muted">Outside the 2-30 min fit window</div>}
              </div>
            );
          }}
        />
        <Line
          type="monotone"
          dataKey="fitted"
          name="Fitted CS model"
          stroke={theme.statusGood}
          strokeWidth={2}
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="graded"
          name="Best effort"
          stroke={chartColors.accent}
          strokeWidth={2}
          dot={{ r: 3.5, fill: chartColors.accent, strokeWidth: 0 }}
          isAnimationActive={false}
        />
        <Scatter dataKey="actual" fill={chartColors.inkMuted} shape="cross" isAnimationActive={false} />
      </ComposedChart>
      </ResponsiveContainer>

      {/* Three series on one plot needs naming — the tooltip alone can't tell the
          reader what the grey crosses are before they hover. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: chartColors.accent }} />
          Best effort (grade-adjusted)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: theme.statusGood }} />
          Fitted CS model
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden style={{ color: chartColors.inkMuted }}>
            &#10005;
          </span>
          Pace as actually run
        </span>
      </div>
    </>
  );
}
