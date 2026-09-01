"use client";

import {
  ComposedChart,
  Line,
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
import { formatEffortDuration } from "@/lib/format";
import type { PowerDurationPoint } from "@/lib/dashboard/queries";

/**
 * The power-duration curve — deliberately the same shape, axes and legend grammar as the
 * Critical Speed chart, since they are the same model in different units and reading them
 * side by side is the point.
 *
 * The one deviation: power is NOT axis-reversed. Higher watts is better and reads higher,
 * whereas pace needed reversing because a faster pace is a smaller number. Duration stays
 * log-scaled for the same reason as the pace curve — the durations are geometric, and the
 * short end is where the finite reserve lives.
 */
export function PowerDurationChart({
  points,
  criticalPowerWatts,
}: {
  points: PowerDurationPoint[];
  criticalPowerWatts: number | null;
}) {
  const chartData = points.map((p) => ({
    durationSeconds: p.durationSeconds,
    durationLabel: formatEffortDuration(p.durationSeconds),
    watts: Math.round(p.watts),
    fitted: p.fittedWatts != null ? Math.round(p.fittedWatts) : null,
    activityName: p.activityName,
    achievedOn: p.achievedOn,
    usedInFit: p.usedInFit,
  }));

  const values = chartData.flatMap((d) => [d.watts, d.fitted].filter((v): v is number => v != null));
  if (criticalPowerWatts != null) values.push(Math.round(criticalPowerWatts));
  // Round the padded domain out to the nearest 50W so Recharts derives round ticks —
  // a raw padded domain yields axis labels like 292W / 442W / 592W / 721W.
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(10, (hi - lo) * 0.15);
  const domainLow = Math.max(0, Math.floor((lo - pad) / 50) * 50);
  const domainHigh = Math.ceil((hi + pad) / 50) * 50;

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
            axisLine={false}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            width={46}
            domain={[domainLow, domainHigh]}
            tickFormatter={(v: number) => `${v}W`}
          />
          {criticalPowerWatts != null && (
            <ReferenceLine
              y={Math.round(criticalPowerWatts)}
              stroke={theme.statusGood}
              strokeDasharray="5 4"
              strokeWidth={1.5}
            >
              <Label
                value={`CP ${Math.round(criticalPowerWatts)}W`}
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
                    Best {point.durationLabel}: {point.watts}W
                  </div>
                  {point.fitted != null && <div className="mt-0.5 text-ink-secondary">Model predicts {point.fitted}W</div>}
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
            name="Fitted CP model"
            stroke={theme.statusGood}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="watts"
            name="Best power"
            stroke={chartColors.accent}
            strokeWidth={2}
            dot={{ r: 3.5, fill: chartColors.accent, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: chartColors.accent }} />
          Best power
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: theme.statusGood }} />
          Fitted CP model
        </span>
      </div>
    </>
  );
}
